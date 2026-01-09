const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/init');

// 2024 Federal Poverty Level guidelines (continental US)
const FPL_BASE = 15060; // For 1 person
const FPL_PER_PERSON = 5380; // Additional per person

function getFPL(householdSize) {
  return FPL_BASE + (Math.max(0, householdSize - 1) * FPL_PER_PERSON);
}

function getFPLPercent(income, householdSize) {
  const fpl = getFPL(householdSize);
  return (income / fpl) * 100;
}

// Estimate APTC based on income as % of FPL
// This is a simplified calculation - actual APTC depends on benchmark plan
function estimateSubsidy(income, householdSize, benchmarkPremium, age) {
  const fplPercent = getFPLPercent(income, householdSize);

  // No subsidy above 400% FPL (unless eAPTC rules apply through 2025)
  // For simplicity, using extended APTC rules through 2025
  if (fplPercent > 400) {
    // Under eAPTC: premium capped at 8.5% of income
    const maxContribution = income * 0.085 / 12;
    const subsidy = Math.max(0, benchmarkPremium - maxContribution);
    return { subsidy: Math.round(subsidy), fplPercent: Math.round(fplPercent), eligible: subsidy > 0 };
  }

  // Below 150% FPL: ~0% of income (effectively free Silver plans)
  // 150-200% FPL: 0-2% of income
  // 200-250% FPL: 2-4% of income
  // 250-300% FPL: 4-6% of income
  // 300-400% FPL: 6-8.5% of income

  let contributionPercent;
  if (fplPercent <= 150) {
    contributionPercent = 0;
  } else if (fplPercent <= 200) {
    contributionPercent = ((fplPercent - 150) / 50) * 0.02;
  } else if (fplPercent <= 250) {
    contributionPercent = 0.02 + ((fplPercent - 200) / 50) * 0.02;
  } else if (fplPercent <= 300) {
    contributionPercent = 0.04 + ((fplPercent - 250) / 50) * 0.02;
  } else {
    contributionPercent = 0.06 + ((fplPercent - 300) / 100) * 0.025;
  }

  const monthlyContribution = (income * contributionPercent) / 12;
  const subsidy = Math.max(0, benchmarkPremium - monthlyContribution);

  return {
    subsidy: Math.round(subsidy),
    fplPercent: Math.round(fplPercent),
    eligible: fplPercent >= 100 && fplPercent <= 400,
    monthlyContribution: Math.round(monthlyContribution)
  };
}

router.get('/', (req, res) => {
  const db = getDatabase();
  try {
    const states = db.prepare(`
      SELECT DISTINCT state_code FROM plans
      WHERE market_coverage = 'Individual'
      ORDER BY state_code
    `).all();
    res.render('index', { states: states.map(s => s.state_code) });
  } finally {
    db.close();
  }
});

router.get('/plans', (req, res) => {
  const db = getDatabase();
  try {
    const { state, county, metal, type, age, tobacco, issuer, income, household, sort } = req.query;

    if (!state || !county) {
      return res.redirect('/');
    }

    const metalLevels = db.prepare(`
      SELECT DISTINCT metal_level FROM plans
      WHERE state_code = ? AND metal_level IS NOT NULL AND market_coverage = 'Individual'
        AND metal_level NOT IN ('High', 'Low')
      ORDER BY CASE metal_level
        WHEN 'Catastrophic' THEN 1
        WHEN 'Bronze' THEN 2
        WHEN 'Expanded Bronze' THEN 3
        WHEN 'Silver' THEN 4
        WHEN 'Gold' THEN 5
        WHEN 'Platinum' THEN 6
        ELSE 7
      END
    `).all(state);

    const planTypes = db.prepare(`
      SELECT DISTINCT plan_type FROM plans
      WHERE state_code = ? AND plan_type IS NOT NULL AND market_coverage = 'Individual'
      ORDER BY plan_type
    `).all(state);

    // Get issuers available in this county
    const issuers = db.prepare(`
      SELECT DISTINCT p.issuer_name
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
        AND p.plan_id LIKE '%-01' AND p.issuer_name IS NOT NULL
      ORDER BY p.issuer_name
    `).all(state, county);

    let query = `
      SELECT DISTINCT p.*
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
        AND p.plan_id LIKE '%-01'
    `;
    const params = [state, county];

    if (metal && metal !== 'all') {
      query += ' AND p.metal_level = ?';
      params.push(metal);
    }
    if (type && type !== 'all') {
      query += ' AND p.plan_type = ?';
      params.push(type);
    }
    if (issuer && issuer !== 'all') {
      query += ' AND p.issuer_name = ?';
      params.push(issuer);
    }

    query += ' ORDER BY p.metal_level, p.medical_deductible_individual, p.plan_marketing_name';

    let plans = db.prepare(query).all(...params);

    const ageToUse = age || '30';
    const isTobacco = tobacco === 'on';
    const incomeVal = income ? parseInt(income.replace(/,/g, ''), 10) : null;
    const householdSize = household ? parseInt(household, 10) : 1;

    // Use standard_component_id to match rates (rates don't have the -XX suffix)
    const rateQuery = db.prepare(`
      SELECT individual_rate, individual_tobacco_rate
      FROM rates
      WHERE plan_id = ? AND age = ?
      LIMIT 1
    `);

    // Find benchmark plan (second-lowest Silver) for subsidy calculation
    let benchmarkPremium = null;
    if (incomeVal) {
      const silverPlans = plans
        .filter(p => p.metal_level === 'Silver')
        .map(p => {
          const rate = rateQuery.get(p.standard_component_id, ageToUse);
          return rate ? (isTobacco && rate.individual_tobacco_rate ? rate.individual_tobacco_rate : rate.individual_rate) : null;
        })
        .filter(r => r !== null)
        .sort((a, b) => a - b);

      benchmarkPremium = silverPlans.length >= 2 ? silverPlans[1] : (silverPlans[0] || 500);
    }

    // Calculate subsidy info
    let subsidyInfo = null;
    if (incomeVal && benchmarkPremium) {
      subsidyInfo = estimateSubsidy(incomeVal, householdSize, benchmarkPremium);
    }

    for (const plan of plans) {
      // Use standard_component_id for rate lookup
      const rate = rateQuery.get(plan.standard_component_id, ageToUse);
      if (rate) {
        plan.monthly_premium = isTobacco && rate.individual_tobacco_rate
          ? rate.individual_tobacco_rate
          : rate.individual_rate;

        // Calculate subsidized premium
        if (subsidyInfo && subsidyInfo.eligible) {
          plan.subsidized_premium = Math.max(0, Math.round(plan.monthly_premium - subsidyInfo.subsidy));
        }
      } else {
        plan.monthly_premium = null;
      }
    }

    // Sort plans based on sort parameter (default: price low to high)
    const sortOption = sort || 'price_asc';
    const getPremium = (plan) => {
      if (subsidyInfo && subsidyInfo.eligible && typeof plan.subsidized_premium === 'number') {
        return plan.subsidized_premium;
      }
      return plan.monthly_premium || Infinity;
    };

    plans.sort((a, b) => {
      switch (sortOption) {
        case 'price_asc':
          return getPremium(a) - getPremium(b);
        case 'price_desc':
          return getPremium(b) - getPremium(a);
        case 'deductible_asc':
          return (a.medical_deductible_individual || Infinity) - (b.medical_deductible_individual || Infinity);
        case 'deductible_desc':
          return (b.medical_deductible_individual || 0) - (a.medical_deductible_individual || 0);
        case 'oop_asc':
          return (a.medical_moop_individual || Infinity) - (b.medical_moop_individual || Infinity);
        default:
          return getPremium(a) - getPremium(b);
      }
    });

    const states = db.prepare(`
      SELECT DISTINCT state_code FROM plans WHERE market_coverage = 'Individual' ORDER BY state_code
    `).all();

    res.render('plans', {
      plans,
      states: states.map(s => s.state_code),
      metalLevels: metalLevels.map(m => m.metal_level),
      planTypes: planTypes.map(t => t.plan_type),
      issuers: issuers.map(i => i.issuer_name),
      subsidyInfo,
      filters: {
        state,
        county,
        metal: metal || 'all',
        type: type || 'all',
        age: ageToUse,
        tobacco: isTobacco,
        issuer: issuer || 'all',
        income: incomeVal || '',
        household: householdSize,
        sort: sortOption
      },
    });
  } finally {
    db.close();
  }
});

router.get('/plan/:id', (req, res) => {
  const db = getDatabase();
  try {
    const plan = db.prepare('SELECT * FROM plans WHERE plan_id = ?').get(req.params.id);
    if (!plan) {
      return res.status(404).render('error', { message: 'Plan not found' });
    }

    // Use standard_component_id for benefits and rates lookup
    const baseId = plan.standard_component_id;

    const benefits = db.prepare(`
      SELECT * FROM benefits WHERE plan_id = ? AND is_covered = 1 ORDER BY benefit_name
    `).all(baseId);

    const rates = db.prepare(`
      SELECT DISTINCT age, individual_rate
      FROM rates
      WHERE plan_id = ?
      ORDER BY
        CASE
          WHEN age = '0-14' THEN 0
          WHEN age = '14 and under' THEN 0
          WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER)
          ELSE 100
        END
    `).all(baseId);

    res.render('plan', { plan, benefits, rates });
  } finally {
    db.close();
  }
});

router.get('/compare', (req, res) => {
  const db = getDatabase();
  try {
    const ids = req.query.ids;
    if (!ids) {
      return res.redirect('/');
    }

    const planIds = ids.split(',').slice(0, 4);
    const placeholders = planIds.map(() => '?').join(',');

    const plans = db.prepare(`
      SELECT * FROM plans WHERE plan_id IN (${placeholders})
    `).all(...planIds);

    const benefitsMap = {};
    const ratesMap = {};

    for (const plan of plans) {
      const baseId = plan.standard_component_id;

      benefitsMap[plan.plan_id] = db.prepare(`
        SELECT * FROM benefits WHERE plan_id = ? AND is_covered = 1 ORDER BY benefit_name
      `).all(baseId);

      ratesMap[plan.plan_id] = db.prepare(`
        SELECT DISTINCT age, individual_rate
        FROM rates
        WHERE plan_id = ?
        ORDER BY CASE WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER) ELSE 0 END
      `).all(baseId);
    }

    const allBenefits = [...new Set(
      Object.values(benefitsMap).flat().map(b => b.benefit_name)
    )].sort();

    res.render('compare', { plans, benefitsMap, ratesMap, allBenefits });
  } finally {
    db.close();
  }
});

module.exports = router;
