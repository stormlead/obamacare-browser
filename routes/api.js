const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../db/init');

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

router.get('/zipcode/:zip', (req, res) => {
  const zip = req.params.zip.padStart(5, '0');
  const entries = zipCodeMap.get(zip);

  if (!entries || entries.length === 0) {
    return res.status(404).json({ error: 'Zip code not found' });
  }

  const db = getDatabase();
  try {
    // Get unique counties for this zip code
    const uniqueCounties = [...new Set(entries.map(e => e.county))];
    const state = entries[0].state;

    // Get all service area county names for this state that have plans
    const serviceAreaCounties = db.prepare(`
      SELECT DISTINCT sa.county_name
      FROM service_areas sa
      JOIN plans p ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name IS NOT NULL AND p.market_coverage = 'Individual'
    `).all(state).map(r => r.county_name);

    // Match zip code counties to service area counties using fuzzy matching
    const availableCounties = [];
    for (const zipCounty of uniqueCounties) {
      // Try exact match first
      if (serviceAreaCounties.includes(zipCounty)) {
        availableCounties.push(zipCounty);
        continue;
      }

      // Fuzzy match: service area county starts with or contains the zip county name
      const zipCountyLower = zipCounty.toLowerCase();
      for (const saCounty of serviceAreaCounties) {
        const saCountyLower = saCounty.toLowerCase();
        // Strip common suffixes from service area name for comparison
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
  } finally {
    db.close();
  }
});

router.get('/states', (req, res) => {
  const db = getDatabase();
  try {
    const states = db.prepare(`
      SELECT DISTINCT state_code
      FROM plans
      WHERE market_coverage = 'Individual'
      ORDER BY state_code
    `).all();
    res.json(states.map(s => s.state_code));
  } finally {
    db.close();
  }
});

router.get('/counties/:state', (req, res) => {
  const db = getDatabase();
  try {
    // Get counties from service_areas that have plans available
    const counties = db.prepare(`
      SELECT DISTINCT sa.county_name
      FROM service_areas sa
      JOIN plans p ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ?
        AND sa.county_name IS NOT NULL
        AND p.market_coverage = 'Individual'
      ORDER BY sa.county_name
    `).all(req.params.state);
    res.json(counties);
  } finally {
    db.close();
  }
});

router.get('/plans/:state/:county', (req, res) => {
  const db = getDatabase();
  try {
    const { state, county } = req.params;
    const { metal, type, sort, age } = req.query;

    let query = `
      SELECT DISTINCT p.*
      FROM plans p
      JOIN service_areas sa ON p.service_area_id = sa.service_area_id AND p.state_code = sa.state_code
      WHERE sa.state_code = ? AND sa.county_name = ? AND p.market_coverage = 'Individual'
        AND (p.dental_only_plan IS NULL OR p.dental_only_plan = 0)
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

    const plans = db.prepare(query).all(...params);

    if (age) {
      const rateQuery = db.prepare(`
        SELECT plan_id, individual_rate
        FROM rates
        WHERE plan_id = ? AND age = ? AND (tobacco = 'No Preference' OR tobacco IS NULL)
        LIMIT 1
      `);
      for (const plan of plans) {
        const rate = rateQuery.get(plan.plan_id, age);
        plan.monthly_premium = rate ? rate.individual_rate : null;
      }
    }

    res.json(plans);
  } finally {
    db.close();
  }
});

router.get('/plan/:id', (req, res) => {
  const db = getDatabase();
  try {
    const plan = db.prepare('SELECT * FROM plans WHERE plan_id = ?').get(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const benefits = db.prepare(`
      SELECT * FROM benefits WHERE plan_id = ? ORDER BY benefit_name
    `).all(req.params.id);

    const rates = db.prepare(`
      SELECT DISTINCT age, individual_rate
      FROM rates
      WHERE plan_id = ? AND (tobacco = 'No Preference' OR tobacco IS NULL)
      ORDER BY
        CASE
          WHEN age = '0-14' THEN 0
          WHEN age = '14 and under' THEN 0
          WHEN age GLOB '[0-9]*' THEN CAST(age AS INTEGER)
          ELSE 100
        END
    `).all(req.params.id);

    res.json({ plan, benefits, rates });
  } finally {
    db.close();
  }
});

module.exports = router;
