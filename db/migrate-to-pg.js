// Migrate data from SQLite to PostgreSQL
// Usage: DATABASE_URL=postgres://... node db/migrate-to-pg.js

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const sqliteDb = new Database(path.join(__dirname, '..', 'plans.db'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Creating tables...');

    // Create tables
    await client.query(`
      DROP TABLE IF EXISTS rates CASCADE;
      DROP TABLE IF EXISTS benefits CASCADE;
      DROP TABLE IF EXISTS service_areas CASCADE;
      DROP TABLE IF EXISTS plans CASCADE;

      CREATE TABLE plans (
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
        is_new_plan TEXT,
        plan_effective_date TEXT,
        plan_expiration_date TEXT,
        out_of_country_coverage TEXT,
        national_network TEXT,
        child_only_offering TEXT,
        rating_area TEXT,
        medical_deductible_individual TEXT,
        medical_deductible_family TEXT,
        drug_deductible_individual TEXT,
        drug_deductible_family TEXT,
        medical_moop_individual TEXT,
        medical_moop_family TEXT,
        drug_moop_individual TEXT,
        drug_moop_family TEXT,
        hsa_eligible TEXT
      );

      CREATE TABLE service_areas (
        id SERIAL PRIMARY KEY,
        service_area_id TEXT,
        state_code TEXT,
        county_name TEXT,
        cover_entire_state TEXT
      );

      CREATE TABLE benefits (
        id SERIAL PRIMARY KEY,
        plan_id TEXT,
        benefit_name TEXT,
        is_covered TEXT,
        copay_in_network TEXT,
        copay_out_of_network TEXT,
        coinsurance_in_network TEXT,
        coinsurance_out_of_network TEXT,
        is_ehb TEXT,
        quantity_limit TEXT,
        limit_unit TEXT,
        limit_quantity TEXT,
        exclusions TEXT,
        explanation TEXT
      );

      CREATE TABLE rates (
        id SERIAL PRIMARY KEY,
        plan_id TEXT,
        state_code TEXT,
        rating_area TEXT,
        tobacco TEXT,
        age TEXT,
        individual_rate TEXT,
        individual_tobacco_rate TEXT
      );
    `);

    // Migrate plans
    console.log('Migrating plans...');
    const plans = sqliteDb.prepare('SELECT * FROM plans').all();
    console.log(`  Found ${plans.length} plans`);

    for (let i = 0; i < plans.length; i += 1000) {
      const batch = plans.slice(i, i + 1000);
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const p of batch) {
        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(
          p.plan_id, p.standard_component_id, p.plan_marketing_name, p.hios_issuer_id,
          p.issuer_name, p.state_code, p.service_area_id, p.market_coverage,
          p.metal_level, p.plan_type, p.is_new_plan, p.plan_effective_date,
          p.plan_expiration_date, p.out_of_country_coverage, p.national_network,
          p.child_only_offering, p.rating_area, p.medical_deductible_individual,
          p.medical_deductible_family, p.drug_deductible_individual, p.drug_deductible_family,
          p.medical_moop_individual, p.medical_moop_family, p.drug_moop_individual,
          p.drug_moop_family, p.hsa_eligible
        );
      }

      await client.query(`
        INSERT INTO plans (plan_id, standard_component_id, plan_marketing_name, hios_issuer_id,
          issuer_name, state_code, service_area_id, market_coverage, metal_level, plan_type,
          is_new_plan, plan_effective_date, plan_expiration_date, out_of_country_coverage,
          national_network, child_only_offering, rating_area, medical_deductible_individual,
          medical_deductible_family, drug_deductible_individual, drug_deductible_family,
          medical_moop_individual, medical_moop_family, drug_moop_individual, drug_moop_family,
          hsa_eligible)
        VALUES ${placeholders.join(', ')}
      `, values);

      console.log(`  Migrated ${Math.min(i + 1000, plans.length)}/${plans.length} plans`);
    }

    // Migrate service_areas
    console.log('Migrating service_areas...');
    const serviceAreas = sqliteDb.prepare('SELECT * FROM service_areas').all();
    console.log(`  Found ${serviceAreas.length} service areas`);

    for (let i = 0; i < serviceAreas.length; i += 1000) {
      const batch = serviceAreas.slice(i, i + 1000);
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const sa of batch) {
        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(sa.service_area_id, sa.state_code, sa.county_name, sa.cover_entire_state);
      }

      await client.query(`
        INSERT INTO service_areas (service_area_id, state_code, county_name, cover_entire_state)
        VALUES ${placeholders.join(', ')}
      `, values);

      console.log(`  Migrated ${Math.min(i + 1000, serviceAreas.length)}/${serviceAreas.length} service areas`);
    }

    // Migrate benefits
    console.log('Migrating benefits...');
    const benefitsCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM benefits').get().count;
    console.log(`  Found ${benefitsCount} benefits`);

    const benefitsStmt = sqliteDb.prepare('SELECT * FROM benefits LIMIT ? OFFSET ?');
    for (let i = 0; i < benefitsCount; i += 5000) {
      const batch = benefitsStmt.all(5000, i);
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const b of batch) {
        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(
          b.plan_id, b.benefit_name, b.is_covered, b.copay_in_network,
          b.copay_out_of_network, b.coinsurance_in_network, b.coinsurance_out_of_network,
          b.is_ehb, b.quantity_limit, b.limit_unit, b.limit_quantity, b.exclusions
        );
      }

      await client.query(`
        INSERT INTO benefits (plan_id, benefit_name, is_covered, copay_in_network,
          copay_out_of_network, coinsurance_in_network, coinsurance_out_of_network,
          is_ehb, quantity_limit, limit_unit, limit_quantity, exclusions)
        VALUES ${placeholders.join(', ')}
      `, values);

      console.log(`  Migrated ${Math.min(i + 5000, benefitsCount)}/${benefitsCount} benefits`);
    }

    // Migrate rates - use smaller batch and row-by-row insertion for reliability
    console.log('Migrating rates...');
    const ratesCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM rates').get().count;
    console.log(`  Found ${ratesCount} rates`);

    const BATCH_SIZE = 5000;
    const ratesStmt = sqliteDb.prepare('SELECT plan_id, state_code, rating_area, tobacco, age, individual_rate, individual_tobacco_rate FROM rates LIMIT ? OFFSET ?');

    for (let i = 0; i < ratesCount; i += BATCH_SIZE) {
      const batch = ratesStmt.all(BATCH_SIZE, i);

      // Skip empty batches
      if (!batch || batch.length === 0) {
        continue;
      }

      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const r of batch) {
        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(
          r.plan_id || null,
          r.state_code || null,
          r.rating_area || null,
          r.tobacco || null,
          r.age || null,
          r.individual_rate || null,
          r.individual_tobacco_rate || null
        );
      }

      if (placeholders.length > 0 && values.length === placeholders.length * 7) {
        await client.query(`
          INSERT INTO rates (plan_id, state_code, rating_area, tobacco, age, individual_rate, individual_tobacco_rate)
          VALUES ${placeholders.join(', ')}
        `, values);
      } else {
        console.log(`  Warning: Batch at offset ${i} had mismatched placeholders (${placeholders.length}) vs values (${values.length})`);
      }

      console.log(`  Migrated ${Math.min(i + BATCH_SIZE, ratesCount)}/${ratesCount} rates`);
    }

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_plans_state ON plans(state_code);
      CREATE INDEX IF NOT EXISTS idx_plans_metal ON plans(metal_level);
      CREATE INDEX IF NOT EXISTS idx_plans_service_area ON plans(service_area_id);
      CREATE INDEX IF NOT EXISTS idx_service_areas_state_county ON service_areas(state_code, county_name);
      CREATE INDEX IF NOT EXISTS idx_service_areas_id ON service_areas(service_area_id);
      CREATE INDEX IF NOT EXISTS idx_benefits_plan ON benefits(plan_id);
      CREATE INDEX IF NOT EXISTS idx_rates_plan ON rates(plan_id);
      CREATE INDEX IF NOT EXISTS idx_rates_plan_age ON rates(plan_id, age);
      CREATE INDEX IF NOT EXISTS idx_rates_area ON rates(state_code, rating_area);
    `);

    console.log('Migration complete!');
  } finally {
    client.release();
    await pool.end();
    sqliteDb.close();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
