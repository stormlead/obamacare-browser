const express = require('express');
const router = express.Router();
const { isPostgres, getPool, getDatabase } = require('../db/init');

// 2025 Federal Poverty Level guidelines (continental US) - used for 2026 coverage
const FPL_BASE = 15650;
const FPL_PER_PERSON = 5500;

function getFPL(householdSize) {
  return FPL_BASE + (Math.max(0, householdSize - 1) * FPL_PER_PERSON);
}

function getFPLPercent(income, householdSize) {
  const fpl = getFPL(householdSize);
  return (income / fpl) * 100;
}

// 2026 ACA contribution percentages (enhanced credits expire end of 2025)
// These are the applicable percentages from IRS for 2026
function getApplicablePercentage(fplPercent) {
  if (fplPercent < 100) return null; // Not eligible
  if (fplPercent > 400) return null; // Not eligible in 2026

  // 2026 contribution percentages (linear interpolation within bands)
  if (fplPercent <= 133) {
    // 100% to 133%: 2.10% flat
    return 0.0210;
  } else if (fplPercent <= 150) {
    // 133% to 150%: 3.14% to 4.19%
    return 0.0314 + ((fplPercent - 133) / 17) * (0.0419 - 0.0314);
  } else if (fplPercent <= 200) {
    // 150% to 200%: 4.19% to 6.60%
    return 0.0419 + ((fplPercent - 150) / 50) * (0.0660 - 0.0419);
  } else if (fplPercent <= 250) {
    // 200% to 250%: 6.60% to 8.44%
    return 0.0660 + ((fplPercent - 200) / 50) * (0.0844 - 0.0660);
  } else if (fplPercent <= 300) {
    // 250% to 300%: 8.44% to 9.96%
    return 0.0844 + ((fplPercent - 250) / 50) * (0.0996 - 0.0844);
  } else {
    // 300% to 400%: 9.96% flat
    return 0.0996;
  }
}

function estimateSubsidy(income, householdSize, benchmarkPremium) {
  const fplPercent = getFPLPercent(income, householdSize);
  const applicablePercent = getApplicablePercentage(fplPercent);

  // Not eligible if below 100% or above 400% FPL in 2026
  if (applicablePercent === null) {
    return {
      subsidy: 0,
      fplPercent: Math.round(fplPercent),
      eligible: false,
      monthlyContribution: fplPercent < 100 ? 0 : Math.round(benchmarkPremium)
    };
  }

  const monthlyContribution = (income * applicablePercent) / 12;
  const subsidy = Math.max(0, benchmarkPremium - monthlyContribution);

  return {
    subsidy: Math.round(subsidy),
    fplPercent: Math.round(fplPercent),
    eligible: true,
    monthlyContribution: Math.round(monthlyContribution)
  };
}

// Helper to run queries on either database
async function dbQuery(sql, params = []) {
  if (isPostgres()) {
    // Convert ? to $1, $2, etc
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`)
      .replace(/GLOB '\[0-9\]\*'/g, "~ '^[0-9]+'"); // SQLite GLOB to PG regex
    const result = await getPool().query(pgSql, params);
    return result.rows;
  } else {
    const db = getDatabase();
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }
}

async function dbQueryOne(sql, params = []) {
  const rows = await dbQuery(sql, params);
  return rows[0] || null;
}

router.get('/', async (req, res, next) => {
  try {
    const states = await dbQuery(`
      SELECT DISTINCT state_code FROM plans
      WHERE market_coverage = 'Individual'
      ORDER BY state_code
    `);
    res.render('index', { states: states.map(s => s.state_code) });
  } catch (err) {
    next(err);
  }
});

router.get('/plans', async (req, res, next) => {
  try {
    const { state, county, metal, type, age, tobacco, issuer, income, household, sort } = req.query;

    if (!state || !county) {
      return res.redirect('/');
    }

    const metalLevels = await dbQuery(`
      SELECT DISTINCT metal_level,
        CASE metal_level
          WHEN 'Catastrophic' THEN 1
          WHEN 'Bronze' THEN 2
          WHEN 'Expanded Bronze' THEN 3
          WHEN 'Silver' THEN 4
          WHEN 'Gold' THEN 5
          WHEN 'Platinum' THEN 6
          ELSE 7
        END as sort_order
      FROM plans
      WHERE state_code = ? AND metal_level IS NOT NULL AND market_coverage = 'Individual'
        AND metal_level NOT IN ('High', 'Low')
      ORDER BY sort_order
    `, [state]);

    const planTypes = await dbQuery(`
      SELECT DISTINCT plan_type FROM plans
      WHERE state_code = ? AND plan_type IS NOT NULL AND market_coverage = 'Individual'
      ORDER BY plan_type
    `, [state]);

    const issuers = await dbQuery(`
      SELECT DISTINCT p.issuer_name
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
        AND p.plan_id LIKE '%-01' AND p.issuer_name IS NOT NULL
        AND p.metal_level NOT IN ('High', 'Low')
      ORDER BY p.issuer_name
    `, [state, county]);

    let query = `
      SELECT DISTINCT p.*
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
        AND p.plan_id LIKE '%-01'
        AND p.metal_level NOT IN ('High', 'Low')
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

    let plans = await dbQuery(query, params);

    const ageToUse = age || '30';
    const isTobacco = tobacco === 'on';
    const incomeVal = income ? parseInt(income.replace(/,/g, ''), 10) : null;
    const householdSize = household ? parseInt(household, 10) : 1;

    // Get rates for all plans
    const planIds = plans.map(p => p.standard_component_id);
    let ratesMap = {};

    if (planIds.length > 0) {
      if (isPostgres()) {
        const ratesResult = await getPool().query(`
          SELECT plan_id, individual_rate, individual_tobacco_rate
          FROM rates WHERE plan_id = ANY($1) AND age = $2
        `, [planIds, ageToUse]);
        ratesMap = Object.fromEntries(ratesResult.rows.map(r => [r.plan_id, r]));
      } else {
        const db = getDatabase();
        try {
          const rateStmt = db.prepare(`
            SELECT individual_rate, individual_tobacco_rate FROM rates WHERE plan_id = ? AND age = ? LIMIT 1
          `);
          for (const id of planIds) {
            const rate = rateStmt.get(id, ageToUse);
            if (rate) ratesMap[id] = rate;
          }
        } finally {
          db.close();
        }
      }
    }

    // Find benchmark (second-lowest Silver)
    let benchmarkPremium = null;
    if (incomeVal) {
      const silverPlans = plans
        .filter(p => p.metal_level === 'Silver')
        .map(p => {
          const rate = ratesMap[p.standard_component_id];
          return rate ? (isTobacco && rate.individual_tobacco_rate ? rate.individual_tobacco_rate : rate.individual_rate) : null;
        })
        .filter(r => r !== null)
        .sort((a, b) => a - b);
      benchmarkPremium = silverPlans.length >= 2 ? silverPlans[1] : (silverPlans[0] || 500);
    }

    let subsidyInfo = null;
    if (incomeVal && benchmarkPremium) {
      subsidyInfo = estimateSubsidy(incomeVal, householdSize, benchmarkPremium);
    }

    for (const plan of plans) {
      const rate = ratesMap[plan.standard_component_id];
      if (rate) {
        plan.monthly_premium = isTobacco && rate.individual_tobacco_rate
          ? rate.individual_tobacco_rate
          : rate.individual_rate;
        if (subsidyInfo && subsidyInfo.eligible) {
          plan.subsidized_premium = Math.max(0, Math.round(plan.monthly_premium - subsidyInfo.subsidy));
        }
      } else {
        plan.monthly_premium = null;
      }
    }

    // Sort
    const sortOption = sort || 'price_asc';
    const getPremium = (plan) => {
      if (subsidyInfo && subsidyInfo.eligible && typeof plan.subsidized_premium === 'number') {
        return plan.subsidized_premium;
      }
      return plan.monthly_premium || Infinity;
    };

    plans.sort((a, b) => {
      switch (sortOption) {
        case 'price_asc': return getPremium(a) - getPremium(b);
        case 'price_desc': return getPremium(b) - getPremium(a);
        case 'deductible_asc': return (a.medical_deductible_individual || Infinity) - (b.medical_deductible_individual || Infinity);
        case 'deductible_desc': return (b.medical_deductible_individual || 0) - (a.medical_deductible_individual || 0);
        case 'oop_asc': return (a.medical_moop_individual || Infinity) - (b.medical_moop_individual || Infinity);
        default: return getPremium(a) - getPremium(b);
      }
    });

    const allStates = await dbQuery(`
      SELECT DISTINCT state_code FROM plans WHERE market_coverage = 'Individual' ORDER BY state_code
    `);

    res.render('plans', {
      plans,
      states: allStates.map(s => s.state_code),
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
  } catch (err) {
    next(err);
  }
});

router.get('/plan/:id', async (req, res, next) => {
  try {
    const { age, income, household, tobacco } = req.query;

    const plan = await dbQueryOne('SELECT * FROM plans WHERE plan_id = ?', [req.params.id]);
    if (!plan) {
      return res.status(404).render('error', { message: 'Plan not found' });
    }

    const baseId = plan.standard_component_id;

    const benefits = await dbQuery(`
      SELECT * FROM benefits WHERE plan_id = ? AND is_covered = '1' ORDER BY benefit_name
    `, [baseId]);

    // Age sorting differs between SQLite and PostgreSQL
    let ratesSql;
    if (isPostgres()) {
      ratesSql = `
        SELECT DISTINCT age, individual_rate, individual_tobacco_rate,
          CASE
            WHEN age = '0-14' THEN 0
            WHEN age = '14 and under' THEN 0
            WHEN age ~ '^[0-9]+$' THEN CAST(age AS INTEGER)
            ELSE 100
          END as sort_order
        FROM rates WHERE plan_id = ?
        ORDER BY sort_order
      `;
    } else {
      ratesSql = `
        SELECT DISTINCT age, individual_rate, individual_tobacco_rate FROM rates WHERE plan_id = ?
        ORDER BY CASE
          WHEN age = '0-14' THEN 0
          WHEN age = '14 and under' THEN 0
          WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER)
          ELSE 100
        END
      `;
    }
    const rates = await dbQuery(ratesSql, [baseId]);

    // Calculate premium for selected age
    const ageToUse = age || '30';
    const isTobacco = tobacco === 'on';
    const incomeVal = income ? parseInt(String(income).replace(/,/g, ''), 10) : null;
    const householdSize = household ? parseInt(household, 10) : 1;

    let monthlyPremium = null;
    let subsidyInfo = null;

    // Find rate for selected age
    const rateForAge = rates.find(r => r.age === ageToUse);
    if (rateForAge) {
      monthlyPremium = isTobacco && rateForAge.individual_tobacco_rate
        ? parseFloat(rateForAge.individual_tobacco_rate)
        : parseFloat(rateForAge.individual_rate);
    }

    // Calculate subsidy if income provided
    if (incomeVal && monthlyPremium) {
      // Need to find benchmark premium (second-lowest Silver in area)
      // For simplicity, use a default benchmark or fetch from session/query
      // We'll estimate based on this plan if Silver, otherwise use a rough estimate
      let benchmarkPremium = monthlyPremium;
      if (plan.metal_level !== 'Silver') {
        // Rough estimate: Silver plans are typically 10-20% more than Bronze
        benchmarkPremium = monthlyPremium * 1.15;
      }
      subsidyInfo = estimateSubsidy(incomeVal, householdSize, benchmarkPremium);
    }

    res.render('plan', {
      plan,
      benefits,
      rates,
      monthlyPremium,
      subsidyInfo,
      filters: {
        age: ageToUse,
        income: incomeVal,
        household: householdSize,
        tobacco: isTobacco
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/compare', async (req, res, next) => {
  try {
    const ids = req.query.ids;
    if (!ids) {
      return res.redirect('/');
    }

    const planIds = ids.split(',').slice(0, 4);

    let plans;
    if (isPostgres()) {
      const result = await getPool().query('SELECT * FROM plans WHERE plan_id = ANY($1)', [planIds]);
      plans = result.rows;
    } else {
      const placeholders = planIds.map(() => '?').join(',');
      plans = await dbQuery(`SELECT * FROM plans WHERE plan_id IN (${placeholders})`, planIds);
    }

    const benefitsMap = {};
    const ratesMap = {};

    for (const plan of plans) {
      const baseId = plan.standard_component_id;
      benefitsMap[plan.plan_id] = await dbQuery(
        "SELECT * FROM benefits WHERE plan_id = ? AND is_covered = '1' ORDER BY benefit_name",
        [baseId]
      );

      let ratesSql;
      if (isPostgres()) {
        ratesSql = `SELECT DISTINCT age, individual_rate,
          CASE WHEN age ~ '^[0-9]+$' THEN CAST(age AS INTEGER) ELSE 0 END as sort_order
          FROM rates WHERE plan_id = ?
          ORDER BY sort_order`;
      } else {
        ratesSql = `SELECT DISTINCT age, individual_rate FROM rates WHERE plan_id = ?
          ORDER BY CASE WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER) ELSE 0 END`;
      }
      ratesMap[plan.plan_id] = await dbQuery(ratesSql, [baseId]);
    }

    const allBenefits = [...new Set(
      Object.values(benefitsMap).flat().map(b => b.benefit_name)
    )].sort();

    res.render('compare', { plans, benefitsMap, ratesMap, allBenefits });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
