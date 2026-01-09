const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { initDatabase } = require('./init');

const dataDir = path.join(__dirname, '..', 'data');

// Load FIPS to county name mapping
function loadFipsMapping() {
  const fipsPath = path.join(dataDir, 'fips-codes.csv');
  const fipsMap = {};

  if (!fs.existsSync(fipsPath)) {
    console.log('Warning: fips-codes.csv not found, county names will be FIPS codes');
    return fipsMap;
  }

  const content = fs.readFileSync(fipsPath, 'utf-8');
  const lines = content.split('\n').slice(1); // skip header

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const fips = parts[0].trim().padStart(5, '0');
      const name = parts[1].trim().replace(' County', '');
      const state = parts[2].trim();
      if (state && state !== 'NA') {
        fipsMap[fips] = name;
      }
    }
  }

  console.log(`Loaded ${Object.keys(fipsMap).length} FIPS codes`);
  return fipsMap;
}

async function importCSV(filePath, tableName, columnMap, db, transform = null) {
  return new Promise((resolve, reject) => {
    const records = [];
    let count = 0;
    const batchSize = 1000;

    const columns = Object.keys(columnMap);
    const placeholders = columns.map(() => '?').join(', ');
    const insertSQL = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    const insert = db.prepare(insertSQL);

    const insertBatch = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(...row);
      }
    });

    console.log(`Importing ${path.basename(filePath)} into ${tableName}...`);

    const parser = fs
      .createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }));

    parser.on('readable', function () {
      let record;
      while ((record = parser.read()) !== null) {
        // Apply transform if provided
        if (transform) {
          record = transform(record);
        }

        const row = columns.map(col => {
          const csvCol = columnMap[col];
          let value = record[csvCol];

          if (value === '' || value === undefined || value === null) {
            return null;
          }
          if (typeof value === 'string') {
            value = value.trim();
          }
          return value;
        });
        records.push(row);
        count++;

        if (records.length >= batchSize) {
          insertBatch(records);
          records.length = 0;
          if (count % 50000 === 0) {
            console.log(`  Processed ${count.toLocaleString()} rows...`);
          }
        }
      }
    });

    parser.on('error', reject);

    parser.on('end', function () {
      if (records.length > 0) {
        insertBatch(records);
      }
      console.log(`  Completed: ${count.toLocaleString()} rows imported`);
      resolve(count);
    });
  });
}

async function importPlans(db) {
  const files = fs.readdirSync(dataDir).filter(f =>
    f.toLowerCase().includes('plan') &&
    f.toLowerCase().includes('attribute') &&
    f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.log('No Plan Attributes PUF file found. Expected filename containing "plan" and "attribute"');
    return;
  }

  const columnMap = {
    plan_id: 'PlanId',
    standard_component_id: 'StandardComponentId',
    plan_marketing_name: 'PlanMarketingName',
    hios_issuer_id: 'HIOSIssuerId',
    issuer_name: 'IssuerMarketPlaceMarketingName',
    state_code: 'StateCode',
    service_area_id: 'ServiceAreaId',
    market_coverage: 'MarketCoverage',
    metal_level: 'MetalLevel',
    plan_type: 'PlanType',
    is_new_plan: 'IsNewPlan',
    plan_effective_date: 'PlanEffectiveDate',
    plan_expiration_date: 'PlanExpirationDate',
    out_of_country_coverage: 'OutOfCountryCoverage',
    national_network: 'NationalNetwork',
    child_only_offering: 'ChildOnlyOffering',
    rating_area: 'RatingAreaId',
    medical_deductible_individual: 'TEHBDedInnTier1Individual',
    medical_deductible_family: 'TEHBDedInnTier1FamilyPerPerson',
    drug_deductible_individual: 'DEHBDedInnTier1Individual',
    drug_deductible_family: 'DEHBDedInnTier1FamilyPerPerson',
    medical_moop_individual: 'TEHBInnTier1IndividualMOOP',
    medical_moop_family: 'TEHBInnTier1FamilyPerPersonMOOP',
    drug_moop_individual: 'DEHBInnTier1IndividualMOOP',
    drug_moop_family: 'DEHBInnTier1FamilyPerPersonMOOP',
    hsa_eligible: 'HSAOrHRAEmployerContribution',
  };

  for (const file of files) {
    await importCSV(path.join(dataDir, file), 'plans', columnMap, db);
  }
}

async function importServiceAreas(db, fipsMap) {
  const files = fs.readdirSync(dataDir).filter(f =>
    f.toLowerCase().includes('service') &&
    f.toLowerCase().includes('area') &&
    f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.log('No Service Area PUF file found. Expected filename containing "service" and "area"');
    return;
  }

  const columnMap = {
    service_area_id: 'ServiceAreaId',
    state_code: 'StateCode',
    county_name: 'County',
    cover_entire_state: 'CoverEntireState',
  };

  // Transform FIPS codes to county names
  const transform = (record) => {
    if (record.County) {
      const fips = record.County.padStart(5, '0');
      record.County = fipsMap[fips] || record.County;
    }
    return record;
  };

  for (const file of files) {
    await importCSV(path.join(dataDir, file), 'service_areas', columnMap, db, transform);
  }
}

async function importBenefits(db) {
  const files = fs.readdirSync(dataDir).filter(f =>
    f.toLowerCase().includes('benefit') &&
    f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.log('No Benefits PUF file found. Expected filename containing "benefit"');
    return;
  }

  const columnMap = {
    plan_id: 'PlanId',
    benefit_name: 'BenefitName',
    is_covered: 'IsCovered',
    copay_in_network: 'CopayInnTier1',
    copay_out_of_network: 'CopayOutofNet',
    coinsurance_in_network: 'CoinsInnTier1',
    coinsurance_out_of_network: 'CoinsOutofNet',
    is_ehb: 'IsEHB',
    quantity_limit: 'QuantLimitOnSvc',
    limit_unit: 'LimitUnit',
    limit_quantity: 'LimitQty',
    exclusions: 'Exclusions',
    explanation: 'Explanation',
  };

  for (const file of files) {
    await importCSV(path.join(dataDir, file), 'benefits', columnMap, db);
  }
}

async function importRates(db) {
  const files = fs.readdirSync(dataDir).filter(f =>
    f.toLowerCase().includes('rate') &&
    f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.log('No Rate PUF file found. Expected filename containing "rate"');
    return;
  }

  const columnMap = {
    plan_id: 'PlanId',
    state_code: 'StateCode',
    rating_area: 'RatingAreaId',
    tobacco: 'Tobacco',
    age: 'Age',
    individual_rate: 'IndividualRate',
    individual_tobacco_rate: 'IndividualTobaccoRate',
  };

  for (const file of files) {
    await importCSV(path.join(dataDir, file), 'rates', columnMap, db);
  }
}

async function main() {
  console.log('Initializing database...');

  // Delete existing database to start fresh
  const dbPath = path.join(__dirname, '..', 'plans.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('Removed old database');
  }

  const db = initDatabase();

  // Load FIPS mapping
  const fipsMap = loadFipsMapping();

  console.log('\nChecking for PUF files in:', dataDir);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('\nCreated data/ directory. Please download PUF files from:');
    console.log('https://data.cms.gov/marketplace/health-plan-data');
    console.log('\nExpected files:');
    console.log('  - Plan Attributes PUF (e.g., Plan_Attributes_PUF.csv)');
    console.log('  - Benefits and Cost Sharing PUF (e.g., Benefits_Cost_Sharing_PUF.csv)');
    console.log('  - Rate PUF (e.g., Rate_PUF.csv)');
    console.log('  - Service Area PUF (e.g., Service_Area_PUF.csv)');
    process.exit(1);
  }

  const csvFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && !f.includes('fips'));
  if (csvFiles.length === 0) {
    console.log('\nNo CSV files found in data/ directory.');
    console.log('Please download PUF files from: https://data.cms.gov/marketplace/health-plan-data');
    process.exit(1);
  }

  console.log('Found files:', csvFiles);

  try {
    await importPlans(db);
    await importServiceAreas(db, fipsMap);
    await importBenefits(db);
    await importRates(db);

    console.log('\n--- Import Summary ---');
    const counts = {
      plans: db.prepare('SELECT COUNT(*) as count FROM plans').get().count,
      service_areas: db.prepare('SELECT COUNT(*) as count FROM service_areas').get().count,
      benefits: db.prepare('SELECT COUNT(*) as count FROM benefits').get().count,
      rates: db.prepare('SELECT COUNT(*) as count FROM rates').get().count,
    };

    for (const [table, count] of Object.entries(counts)) {
      console.log(`${table}: ${count.toLocaleString()} rows`);
    }

    const states = db.prepare('SELECT DISTINCT state_code FROM plans ORDER BY state_code').all();
    console.log(`\nStates available: ${states.map(s => s.state_code).join(', ')}`);

    // Show sample counties
    const sampleCounties = db.prepare('SELECT DISTINCT state_code, county_name FROM service_areas WHERE county_name IS NOT NULL LIMIT 10').all();
    console.log('\nSample counties:', sampleCounties);

  } catch (err) {
    console.error('Import error:', err);
    process.exit(1);
  } finally {
    db.close();
  }

  console.log('\nImport complete! Run `npm start` to launch the server.');
}

main();
