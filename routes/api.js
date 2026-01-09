const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { isPostgres, getPool, getDatabase } = require('../db/init');

// Load zip code data
let zipCodeData = [];
const zipPath = path.join(__dirname, '..', 'data', 'zipcodes.json');
if (fs.existsSync(zipPath)) {
  zipCodeData = JSON.parse(fs.readFileSync(zipPath, 'utf-8'));
  console.log(`Loaded ${zipCodeData.length} zip codes`);
}

// Create a map for faster lookup
const zipCodeMap = new Map();
for (const entry of zipCodeData) {
  const zip = String(entry.zip_code).padStart(5, '0');
  if (!zipCodeMap.has(zip)) {
    zipCodeMap.set(zip, []);
  }
  zipCodeMap.get(zip).push({
    state: entry.state,
    county: entry.county,
    city: entry.city
  });
}

// Helper to run queries on either database
async function dbQuery(sql, params = []) {
  if (isPostgres()) {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`)
      .replace(/GLOB '\[0-9\]\*'/g, "~ '^[0-9]+'");
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

router.get('/zipcode/:zip', async (req, res, next) => {
  const zip = req.params.zip.padStart(5, '0');
  const entries = zipCodeMap.get(zip);

  if (!entries || entries.length === 0) {
    return res.status(404).json({ error: 'Zip code not found' });
  }

  try {
    const uniqueCounties = [...new Set(entries.map(e => e.county))];
    const state = entries[0].state;

    const serviceAreaCounties = await dbQuery(`
      SELECT DISTINCT sa.county_name
      FROM service_areas sa
      JOIN plans p ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name IS NOT NULL AND p.market_coverage = 'Individual'
    `, [state]);
    const countyNames = serviceAreaCounties.map(r => r.county_name);

    const availableCounties = [];
    for (const zipCounty of uniqueCounties) {
      if (countyNames.includes(zipCounty)) {
        availableCounties.push(zipCounty);
        continue;
      }

      const zipCountyLower = zipCounty.toLowerCase();
      for (const saCounty of countyNames) {
        const saCountyLower = saCounty.toLowerCase();
        const saCountyBase = saCountyLower.replace(/ county| municipality| borough| parish| census area| city and borough/gi, '').trim();

        if (saCountyLower.startsWith(zipCountyLower) ||
            saCountyLower.includes(zipCountyLower + ' ') ||
            saCountyBase === zipCountyLower) {
          availableCounties.push(saCounty);
          break;
        }
      }
    }

    if (availableCounties.length === 0) {
      return res.json({
        state,
        counties: [],
        city: entries[0].city,
        message: 'No marketplace plans available in this area'
      });
    }

    res.json({
      state,
      counties: [...new Set(availableCounties)],
      city: entries[0].city
    });
  } catch (err) {
    next(err);
  }
});

router.get('/states', async (req, res, next) => {
  try {
    const states = await dbQuery(`
      SELECT DISTINCT state_code FROM plans
      WHERE market_coverage = 'Individual'
      ORDER BY state_code
    `);
    res.json(states.map(s => s.state_code));
  } catch (err) {
    next(err);
  }
});

router.get('/counties/:state', async (req, res, next) => {
  try {
    const counties = await dbQuery(`
      SELECT DISTINCT sa.county_name
      FROM service_areas sa
      JOIN plans p ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ?
        AND sa.county_name IS NOT NULL
        AND p.market_coverage = 'Individual'
      ORDER BY sa.county_name
    `, [req.params.state]);
    res.json(counties);
  } catch (err) {
    next(err);
  }
});

router.get('/plans/:state/:county', async (req, res, next) => {
  try {
    const { state, county } = req.params;
    const { metal, type, age } = req.query;

    let query = `
      SELECT DISTINCT p.*
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
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

    query += ' ORDER BY p.metal_level, p.plan_marketing_name';

    const plans = await dbQuery(query, params);

    if (age && plans.length > 0) {
      const planIds = plans.map(p => p.plan_id);
      let ratesMap = {};

      if (isPostgres()) {
        const ratesResult = await getPool().query(`
          SELECT plan_id, individual_rate FROM rates
          WHERE plan_id = ANY($1) AND age = $2 AND (tobacco = 'No Preference' OR tobacco IS NULL)
        `, [planIds, age]);
        ratesMap = Object.fromEntries(ratesResult.rows.map(r => [r.plan_id, r.individual_rate]));
      } else {
        const db = getDatabase();
        try {
          const stmt = db.prepare(`
            SELECT plan_id, individual_rate FROM rates
            WHERE plan_id = ? AND age = ? AND (tobacco = 'No Preference' OR tobacco IS NULL) LIMIT 1
          `);
          for (const id of planIds) {
            const rate = stmt.get(id, age);
            if (rate) ratesMap[id] = rate.individual_rate;
          }
        } finally {
          db.close();
        }
      }

      for (const plan of plans) {
        plan.monthly_premium = ratesMap[plan.plan_id] || null;
      }
    }

    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.get('/plan/:id', async (req, res, next) => {
  try {
    const plans = await dbQuery('SELECT * FROM plans WHERE plan_id = ?', [req.params.id]);
    if (plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const plan = plans[0];

    const benefits = await dbQuery(
      'SELECT * FROM benefits WHERE plan_id = ? ORDER BY benefit_name',
      [req.params.id]
    );

    let ratesSql;
    if (isPostgres()) {
      ratesSql = `
        SELECT DISTINCT age, individual_rate FROM rates
        WHERE plan_id = ? AND (tobacco = 'No Preference' OR tobacco IS NULL)
        ORDER BY CASE
          WHEN age = '0-14' THEN 0
          WHEN age = '14 and under' THEN 0
          WHEN age ~ '^[0-9]+$' THEN CAST(age AS INTEGER)
          ELSE 100
        END
      `;
    } else {
      ratesSql = `
        SELECT DISTINCT age, individual_rate FROM rates
        WHERE plan_id = ? AND (tobacco = 'No Preference' OR tobacco IS NULL)
        ORDER BY CASE
          WHEN age = '0-14' THEN 0
          WHEN age = '14 and under' THEN 0
          WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER)
          ELSE 100
        END
      `;
    }
    const rates = await dbQuery(ratesSql, [req.params.id]);

    res.json({ plan, benefits, rates });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
