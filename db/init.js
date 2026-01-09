const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'plans.db');

function initDatabase() {
  const db = new Database(dbPath);

  db.exec(`
    -- Plans table (from Plan Attributes PUF)
    CREATE TABLE IF NOT EXISTS plans (
      plan_id TEXT PRIMARY KEY,
      standard_component_id TEXT,
      plan_marketing_name TEXT,
      hios_issuer_id TEXT,
      issuer_name TEXT,
      state_code TEXT,
      service_area_id TEXT,
      market_coverage TEXT,
      metal_level TEXT,
      plan_type TEXT,
      is_new_plan INTEGER,
      plan_effective_date TEXT,
      plan_expiration_date TEXT,
      out_of_country_coverage INTEGER,
      national_network INTEGER,
      child_only_offering TEXT,
      rating_area TEXT,
      medical_deductible_individual REAL,
      medical_deductible_family REAL,
      drug_deductible_individual REAL,
      drug_deductible_family REAL,
      medical_moop_individual REAL,
      medical_moop_family REAL,
      drug_moop_individual REAL,
      drug_moop_family REAL,
      hsa_eligible INTEGER
    );

    -- Service areas mapping (from Service Area PUF)
    CREATE TABLE IF NOT EXISTS service_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_area_id TEXT,
      state_code TEXT,
      county_name TEXT,
      cover_entire_state INTEGER
    );

    -- Benefits and cost sharing (from Benefits PUF)
    CREATE TABLE IF NOT EXISTS benefits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT,
      benefit_name TEXT,
      is_covered INTEGER,
      copay_in_network TEXT,
      copay_out_of_network TEXT,
      coinsurance_in_network TEXT,
      coinsurance_out_of_network TEXT,
      is_ehb INTEGER,
      quantity_limit TEXT,
      limit_unit TEXT,
      limit_quantity REAL,
      exclusions TEXT,
      explanation TEXT
    );

    -- Rates (from Rate PUF)
    CREATE TABLE IF NOT EXISTS rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT,
      state_code TEXT,
      rating_area TEXT,
      tobacco TEXT,
      age TEXT,
      individual_rate REAL,
      individual_tobacco_rate REAL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_plans_state ON plans(state_code);
    CREATE INDEX IF NOT EXISTS idx_plans_metal ON plans(metal_level);
    CREATE INDEX IF NOT EXISTS idx_plans_service_area ON plans(service_area_id);
    CREATE INDEX IF NOT EXISTS idx_service_areas_state_county ON service_areas(state_code, county_name);
    CREATE INDEX IF NOT EXISTS idx_service_areas_id ON service_areas(service_area_id);
    CREATE INDEX IF NOT EXISTS idx_benefits_plan ON benefits(plan_id);
    CREATE INDEX IF NOT EXISTS idx_rates_plan ON rates(plan_id);
    CREATE INDEX IF NOT EXISTS idx_rates_area ON rates(state_code, rating_area);
  `);

  return db;
}

function getDatabase() {
  return new Database(dbPath);
}

module.exports = { initDatabase, getDatabase, dbPath };
