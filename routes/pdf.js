const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');
const { isPostgres, getPool, getDatabase } = require('../db/init');

// Reuse database helpers
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

async function dbQueryOne(sql, params = []) {
  const rows = await dbQuery(sql, params);
  return rows[0] || null;
}

function formatMoney(val) {
  if (!val) return 'N/A';
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,]/g, '').trim();
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      return '$' + Math.round(num).toLocaleString();
    }
    return val;
  }
  return '$' + Number(val).toLocaleString();
}

// Common PDF styles for clean printing
const pdfStyles = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #333;
    padding: 0.5in;
  }
  h1 {
    font-size: 18pt;
    color: #1a365d;
    margin-bottom: 4px;
    border-bottom: 2px solid #0970C5;
    padding-bottom: 8px;
  }
  h2 {
    font-size: 14pt;
    color: #2d3748;
    margin: 16px 0 8px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
  }
  .subtitle {
    font-size: 10pt;
    color: #666;
    margin-bottom: 16px;
  }
  .metal-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
  }
  .metal-badge.bronze { background: #fde6c4; color: #8B4513; }
  .metal-badge.silver { background: #e2e8f0; color: #475569; }
  .metal-badge.gold { background: #fef08a; color: #854d0e; }
  .metal-badge.platinum { background: #e2e8f0; color: #374151; }
  .metal-badge.catastrophic { background: #f1f5f9; color: #64748b; }
  .metal-badge.expanded-bronze { background: #fde6c4; color: #8B4513; }
  .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 9pt;
    background: #f1f5f9;
    color: #475569;
    margin-left: 8px;
  }
  .premium-box {
    background: #f0f9ff;
    border: 1px solid #0970C5;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
    text-align: center;
  }
  .premium-value {
    font-size: 28pt;
    font-weight: 700;
    color: #0970C5;
  }
  .premium-label {
    font-size: 10pt;
    color: #666;
    margin-top: 4px;
  }
  .premium-note {
    font-size: 9pt;
    color: #888;
    margin-top: 8px;
  }
  .subsidy-info {
    background: #f0fdf4;
    border: 1px solid #16a34a;
    border-radius: 4px;
    padding: 8px 12px;
    margin-top: 8px;
    font-size: 9pt;
  }
  .cost-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 12px 0;
  }
  .cost-item {
    background: #f8fafc;
    padding: 12px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }
  .cost-item-label {
    font-size: 9pt;
    color: #64748b;
    margin-bottom: 4px;
  }
  .cost-item-value {
    font-size: 13pt;
    font-weight: 600;
    color: #1e293b;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 10pt;
  }
  th, td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
  }
  th {
    background: #f8fafc;
    font-weight: 600;
    color: #475569;
  }
  tr:last-child td {
    border-bottom: none;
  }
  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #888;
    text-align: center;
  }
  .plan-id {
    font-size: 8pt;
    color: #888;
    margin-top: 8px;
  }
  @media print {
    body { padding: 0; }
    .page-break { page-break-before: always; }
  }
  /* Compare page specific */
  .compare-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin: 16px 0;
  }
  .compare-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }
  .compare-card-header {
    padding: 12px;
    border-bottom: 3px solid #e2e8f0;
  }
  .compare-card-header.bronze { background: #fef3e2; border-bottom-color: #CD7F32; }
  .compare-card-header.silver { background: #f8fafc; border-bottom-color: #C0C0C0; }
  .compare-card-header.gold { background: #fefce8; border-bottom-color: #FFD700; }
  .compare-card-header.platinum { background: #f8fafc; border-bottom-color: #E5E4E2; }
  .compare-card-header.catastrophic { background: #f1f5f9; border-bottom-color: #64748b; }
  .compare-card-header.expanded-bronze { background: #fef3e2; border-bottom-color: #CD7F32; }
  .compare-card-header h3 {
    font-size: 11pt;
    margin: 4px 0;
    color: #1e293b;
  }
  .compare-card-header .issuer {
    font-size: 9pt;
    color: #64748b;
  }
  .compare-card-body {
    padding: 12px;
  }
  .compare-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #f1f5f9;
    font-size: 9pt;
  }
  .compare-row:last-child {
    border-bottom: none;
  }
  .compare-row .label {
    color: #64748b;
  }
  .compare-row .value {
    font-weight: 600;
    color: #1e293b;
  }
  .benefits-compare-table {
    font-size: 9pt;
    margin-top: 16px;
  }
  .benefits-compare-table th {
    font-size: 8pt;
  }
`;

// Generate PDF for a single plan
router.get('/plan/:id', async (req, res, next) => {
  let browser;
  try {
    const { age, income, household, tobacco } = req.query;

    const plan = await dbQueryOne('SELECT * FROM plans WHERE plan_id = ?', [req.params.id]);
    if (!plan) {
      return res.status(404).send('Plan not found');
    }

    const baseId = plan.standard_component_id;

    const benefits = await dbQuery(`
      SELECT * FROM benefits WHERE plan_id = ? AND is_covered = '1' ORDER BY benefit_name
    `, [baseId]);

    // Get rate for selected age
    const ageToUse = age || '30';
    const isTobacco = tobacco === 'on';
    const incomeVal = income ? parseInt(String(income).replace(/,/g, ''), 10) : null;
    const householdSize = household ? parseInt(household, 10) : 1;

    let ratesSql;
    if (isPostgres()) {
      ratesSql = `SELECT individual_rate, individual_tobacco_rate FROM rates WHERE plan_id = $1 AND age = $2 LIMIT 1`;
    } else {
      ratesSql = `SELECT individual_rate, individual_tobacco_rate FROM rates WHERE plan_id = ? AND age = ? LIMIT 1`;
    }

    let monthlyPremium = null;
    if (isPostgres()) {
      const result = await getPool().query(ratesSql, [baseId, ageToUse]);
      if (result.rows[0]) {
        const rate = result.rows[0];
        monthlyPremium = isTobacco && rate.individual_tobacco_rate
          ? parseFloat(rate.individual_tobacco_rate)
          : parseFloat(rate.individual_rate);
      }
    } else {
      const db = getDatabase();
      try {
        const rate = db.prepare(ratesSql).get(baseId, ageToUse);
        if (rate) {
          monthlyPremium = isTobacco && rate.individual_tobacco_rate
            ? parseFloat(rate.individual_tobacco_rate)
            : parseFloat(rate.individual_rate);
        }
      } finally {
        db.close();
      }
    }

    // Build HTML
    const metalClass = (plan.metal_level || '').toLowerCase().replace(' ', '-');

    let premiumHtml = '';
    if (monthlyPremium) {
      premiumHtml = `
        <div class="premium-box">
          <div class="premium-value">$${Math.round(monthlyPremium).toLocaleString()}</div>
          <div class="premium-label">per month</div>
          <div class="premium-note">For age ${ageToUse}${isTobacco ? ', tobacco user' : ''}</div>
        </div>
      `;
    }

    const benefitsHtml = benefits.length > 0 ? `
      <h2>Covered Benefits</h2>
      <table>
        <thead>
          <tr>
            <th>Benefit</th>
            <th>In-Network Copay</th>
            <th>In-Network Coinsurance</th>
          </tr>
        </thead>
        <tbody>
          ${benefits.map(b => `
            <tr>
              <td>${b.benefit_name}</td>
              <td>${b.copay_in_network || 'N/A'}</td>
              <td>${b.coinsurance_in_network || 'N/A'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${plan.plan_marketing_name || 'Plan Details'}</title>
        <style>${pdfStyles}</style>
      </head>
      <body>
        <h1>${plan.plan_marketing_name || 'Unnamed Plan'}</h1>
        <div class="subtitle">
          ${plan.issuer_name || 'Unknown Issuer'}
          <span class="metal-badge ${metalClass}">${plan.metal_level || 'N/A'}</span>
          <span class="type-badge">${plan.plan_type || 'N/A'}</span>
          ${plan.hsa_eligible ? '<span class="type-badge">HSA Eligible</span>' : ''}
        </div>

        ${premiumHtml}

        <h2>Cost Summary</h2>
        <div class="cost-grid">
          <div class="cost-item">
            <div class="cost-item-label">Deductible (Individual)</div>
            <div class="cost-item-value">${formatMoney(plan.medical_deductible_individual)}</div>
          </div>
          <div class="cost-item">
            <div class="cost-item-label">Deductible (Family)</div>
            <div class="cost-item-value">${formatMoney(plan.medical_deductible_family)}</div>
          </div>
          <div class="cost-item">
            <div class="cost-item-label">Out-of-Pocket Max (Individual)</div>
            <div class="cost-item-value">${formatMoney(plan.medical_moop_individual)}</div>
          </div>
          <div class="cost-item">
            <div class="cost-item-label">Out-of-Pocket Max (Family)</div>
            <div class="cost-item-value">${formatMoney(plan.medical_moop_family)}</div>
          </div>
          <div class="cost-item">
            <div class="cost-item-label">Drug Deductible (Individual)</div>
            <div class="cost-item-value">${plan.drug_deductible_individual ? formatMoney(plan.drug_deductible_individual) : (plan.medical_deductible_individual ? 'Included in Medical' : 'N/A')}</div>
          </div>
          <div class="cost-item">
            <div class="cost-item-label">Drug Deductible (Family)</div>
            <div class="cost-item-value">${plan.drug_deductible_family ? formatMoney(plan.drug_deductible_family) : (plan.medical_deductible_family ? 'Included in Medical' : 'N/A')}</div>
          </div>
        </div>

        ${benefitsHtml}

        <div class="plan-id">Plan ID: ${plan.plan_id}</div>

        <div class="footer">
          Generated on ${new Date().toLocaleDateString()} | This is an estimate only. Contact the insurance company for final rates and coverage details.
        </div>
      </body>
      </html>
    `;

    // Generate PDF
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });

    await browser.close();

    // Send PDF
    const filename = `${(plan.plan_marketing_name || 'plan').replace(/[^a-z0-9]/gi, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);

  } catch (err) {
    if (browser) await browser.close();
    next(err);
  }
});

// Generate PDF comparing multiple plans
router.get('/compare', async (req, res, next) => {
  let browser;
  try {
    const ids = req.query.ids;
    if (!ids) {
      return res.status(400).send('No plan IDs provided');
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

    if (plans.length === 0) {
      return res.status(404).send('No plans found');
    }

    // Get benefits for all plans
    const benefitsMap = {};
    for (const plan of plans) {
      const baseId = plan.standard_component_id;
      benefitsMap[plan.plan_id] = await dbQuery(
        "SELECT * FROM benefits WHERE plan_id = ? AND is_covered = '1' ORDER BY benefit_name",
        [baseId]
      );
    }

    // Get all unique benefits
    const allBenefits = [...new Set(
      Object.values(benefitsMap).flat().map(b => b.benefit_name)
    )].sort().slice(0, 25); // Limit for PDF space

    // Build comparison cards HTML
    const cardsHtml = plans.map(p => {
      const metalClass = (p.metal_level || '').toLowerCase().replace(' ', '-');
      return `
        <div class="compare-card">
          <div class="compare-card-header ${metalClass}">
            <span class="metal-badge ${metalClass}">${p.metal_level || 'N/A'}</span>
            <h3>${p.plan_marketing_name || 'Unnamed Plan'}</h3>
            <div class="issuer">${p.issuer_name || 'Unknown Issuer'}</div>
          </div>
          <div class="compare-card-body">
            <div class="compare-row">
              <span class="label">Plan Type</span>
              <span class="value">${p.plan_type || 'N/A'}</span>
            </div>
            <div class="compare-row">
              <span class="label">Deductible (Ind.)</span>
              <span class="value">${formatMoney(p.medical_deductible_individual)}</span>
            </div>
            <div class="compare-row">
              <span class="label">Deductible (Fam.)</span>
              <span class="value">${formatMoney(p.medical_deductible_family)}</span>
            </div>
            <div class="compare-row">
              <span class="label">OOP Max (Ind.)</span>
              <span class="value">${formatMoney(p.medical_moop_individual)}</span>
            </div>
            <div class="compare-row">
              <span class="label">OOP Max (Fam.)</span>
              <span class="value">${formatMoney(p.medical_moop_family)}</span>
            </div>
            <div class="compare-row">
              <span class="label">Drug Deductible</span>
              <span class="value">${formatMoney(p.drug_deductible_individual)}</span>
            </div>
            <div class="compare-row">
              <span class="label">HSA Eligible</span>
              <span class="value">${p.hsa_eligible ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Build benefits comparison table
    const benefitsTableHtml = allBenefits.length > 0 ? `
      <h2>Benefits Comparison</h2>
      <table class="benefits-compare-table">
        <thead>
          <tr>
            <th>Benefit</th>
            ${plans.map(p => `<th>${(p.plan_marketing_name || 'Plan').substring(0, 30)}...</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${allBenefits.map(benefitName => `
            <tr>
              <td>${benefitName}</td>
              ${plans.map(p => {
                const benefit = (benefitsMap[p.plan_id] || []).find(b => b.benefit_name === benefitName);
                if (!benefit) return '<td style="color:#94a3b8;">-</td>';
                const copay = benefit.copay_in_network || '';
                const coins = benefit.coinsurance_in_network || '';
                const display = [copay, coins].filter(Boolean).join(' / ') || 'Covered';
                return `<td>${display}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Plan Comparison</title>
        <style>${pdfStyles}</style>
      </head>
      <body>
        <h1>Health Plan Comparison</h1>
        <div class="subtitle">Comparing ${plans.length} plans</div>

        <div class="compare-grid">
          ${cardsHtml}
        </div>

        ${benefitsTableHtml}

        <div class="footer">
          Generated on ${new Date().toLocaleDateString()} | This is an estimate only. Contact the insurance companies for final rates and coverage details.
        </div>
      </body>
      </html>
    `;

    // Generate PDF
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      landscape: plans.length > 2,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });

    await browser.close();

    // Send PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="plan-comparison.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);

  } catch (err) {
    if (browser) await browser.close();
    next(err);
  }
});

module.exports = router;
