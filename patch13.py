import codecs

with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# 1. Update primary toolbar button wiring mapping
old_btn_map = """
  const menuBtnMap={
    tblBtnInsert:'tblMenuInsert',
    tblBtnMerge:'tblMenuMerge',
    tblBtnFit:'tblMenuFit',
    tblBtnAlign:'tblMenuAlign',
    tblBtnFormula:'tblMenuFormula',
    tblBtnFormat:'tblMenuFormat',
    tblBtnMore:'tblMenuMore'
  };
"""
new_btn_map = """
  const menuBtnMap={
    tblBtnMerge:'tblMenuMerge',
    tblBtnLayout:'tblMenuLayout',
    tblBtnThemes:'tblMenuThemes'
  };
"""
if old_btn_map.strip() in content:
    content = content.replace(old_btn_map, new_btn_map)

# 2. Add Theme application logic
theme_code = """
  // Theme Application Logic
  document.querySelectorAll('#tblMenuThemes button[data-theme]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const theme = btn.getAttribute('data-theme');
      const tbl = currentTable();
      if (!tbl) return;
      
      if(window.HistoryManager) window.HistoryManager.capture(true);
      
      // Remove existing themes
      tbl.classList.remove('tbl-theme-default', 'tbl-theme-grayscale', 'tbl-theme-modern', 'tbl-theme-zebra', 'tbl-theme-elegant', 'tbl-theme-accent', 'tbl-theme-dark');
      if (theme) tbl.classList.add(`tbl-theme-${theme}`);
      
      if(window.HistoryManager) window.HistoryManager.capture(true);
      
      document.getElementById('tblMenuThemes')?.classList.remove('show');
      toast(`Applied ${theme} theme`);
    });
  });
  
  // Padding slider logic
  const paddingSlider = document.getElementById('tblMarginSlider');
  if (paddingSlider) {
      paddingSlider.addEventListener('input', e => {
          const tbl = currentTable();
          if(!tbl) return;
          const val = e.target.value;
          tbl.style.setProperty('--cell-padding', `${val}px`);
          Array.from(tbl.querySelectorAll('td, th')).forEach(c => c.classList.add('custom-padding'));
          positionTableTools();
      });
      paddingSlider.addEventListener('change', () => {
          if(window.HistoryManager) window.HistoryManager.queueCapture();
      });
  }

  // Templates Modal toggle
  const btnTemplates = document.getElementById('tblBtnTemplates');
  if (btnTemplates) {
      btnTemplates.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
          document.getElementById('tblTemplateModal')?.classList.add('show');
          renderTemplatesGrid();
      });
  }
"""
if 'btnTemplates.addEventListener' not in content:
    content = content.replace("document.getElementById('tblBtnMobileSheet')?.addEventListener('click', openTblSheet);", "document.getElementById('tblBtnMobileSheet')?.addEventListener('click', openTblSheet);\n" + theme_code)

# 3. Add Template Generator Functions
templates_code = """
const TABLE_TEMPLATES = [
  {
      id: 'invoice',
      icon: 'receipt',
      title: 'Invoice / Billing',
      desc: 'Itemized billing with subtotal, tax, and total formulas.',
      html: `
        <table class="calculeaf-table tbl-theme-modern" style="width: 100%;">
          <thead>
            <tr>
              <th style="width:40%">Item Description</th>
              <th style="width:20%">Qty</th>
              <th style="width:20%">Unit Price</th>
              <th style="width:20%">Line Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Consulting Services</td>
              <td data-value-type="number" data-decimals="0">10</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">150</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td>
            </tr>
            <tr>
              <td>Software License</td>
              <td data-value-type="number" data-decimals="0">1</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">500</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Subtotal</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=SUM(R[-2]C:R[-1]C)</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Tax (8%)</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=R[-1]C*0.08</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Grand Total</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=R[-2]C+R[-1]C</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'budget',
      icon: 'pie-chart',
      title: 'Monthly Budget',
      desc: 'Income & expenses with variance tracking.',
      html: `
        <table class="calculeaf-table tbl-theme-elegant" style="width: 100%;">
          <thead>
            <tr>
              <th style="width:40%">Category</th>
              <th style="width:20%">Expected</th>
              <th style="width:20%">Actual</th>
              <th style="width:20%">Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="4" style="background:#f3f4f6; font-weight:bold;">Income</td>
            </tr>
            <tr>
              <td>Salary</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">4000</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">4000</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-1]-RC[-2]</td>
            </tr>
            <tr>
              <td colspan="4" style="background:#f3f4f6; font-weight:bold;">Expenses</td>
            </tr>
            <tr>
              <td>Rent</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">1500</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">1500</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]-RC[-1]</td>
            </tr>
            <tr>
              <td>Groceries</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">400</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">450</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]-RC[-1]</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Net Savings</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=R[-4]C[0]+R[-3]C[0]+R[-2]C[0]+R[-1]C[0]</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'timesheet',
      icon: 'clock',
      title: 'Weekly Timesheet',
      desc: 'Log daily hours and calculate total weekly pay.',
      html: `
        <table class="calculeaf-table tbl-theme-zebra" style="width: 100%;">
          <thead>
            <tr>
              <th>Day</th>
              <th>Date</th>
              <th>Hours Worked</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Monday</td><td></td><td data-value-type="number" data-decimals="1">8</td></tr>
            <tr><td>Tuesday</td><td></td><td data-value-type="number" data-decimals="1">8</td></tr>
            <tr><td>Wednesday</td><td></td><td data-value-type="number" data-decimals="1">8</td></tr>
            <tr><td>Thursday</td><td></td><td data-value-type="number" data-decimals="1">8</td></tr>
            <tr><td>Friday</td><td></td><td data-value-type="number" data-decimals="1">8</td></tr>
            <tr>
              <td colspan="2" style="text-align:right; font-weight:bold;">Total Hours</td>
              <td data-value-type="number" data-decimals="1" style="font-weight:bold;">=SUM(R[-5]C:R[-1]C)</td>
            </tr>
            <tr>
              <td colspan="2" style="text-align:right; font-weight:bold;">Hourly Rate</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">25</td>
            </tr>
            <tr>
              <td colspan="2" style="text-align:right; font-weight:bold;">Total Pay</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold; color:green;">=R[-2]C*R[-1]C</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'inventory',
      icon: 'package',
      title: 'Inventory Tracking',
      desc: 'Track items in stock and total warehouse value.',
      html: `
        <table class="calculeaf-table tbl-theme-dark" style="width: 100%;">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item Name</th>
              <th>Stock</th>
              <th>Unit Cost</th>
              <th>Total Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>A001</td>
              <td>Widget Pro</td>
              <td data-value-type="number" data-decimals="0">145</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">12.50</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td>
            </tr>
            <tr>
              <td>B002</td>
              <td>Super Widget</td>
              <td data-value-type="number" data-decimals="0">30</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">45.00</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td>
            </tr>
            <tr>
              <td colspan="4" style="text-align:right; font-weight:bold;">Total Inventory Value</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=SUM(R[-2]C:R[-1]C)</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'schools',
      icon: 'graduation-cap',
      title: 'Grade Tracker (Schools)',
      desc: 'Track assignments and calculate weighted GPA.',
      html: `
        <table class="calculeaf-table tbl-theme-modern" style="width: 100%;">
          <thead>
            <tr>
              <th>Course</th>
              <th>Credits</th>
              <th>Grade Points</th>
              <th>Total Quality Points</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Math 101</td><td data-value-type="number" data-decimals="1">3</td><td data-value-type="number" data-decimals="1">4.0</td><td data-value-type="number" data-decimals="1">=RC[-2]*RC[-1]</td></tr>
            <tr><td>History 201</td><td data-value-type="number" data-decimals="1">3</td><td data-value-type="number" data-decimals="1">3.5</td><td data-value-type="number" data-decimals="1">=RC[-2]*RC[-1]</td></tr>
            <tr><td>Physics Lab</td><td data-value-type="number" data-decimals="1">1</td><td data-value-type="number" data-decimals="1">4.0</td><td data-value-type="number" data-decimals="1">=RC[-2]*RC[-1]</td></tr>
            <tr>
              <td style="text-align:right; font-weight:bold;">Totals</td>
              <td data-value-type="number" data-decimals="1" style="font-weight:bold;">=SUM(R[-3]C:R[-1]C)</td>
              <td></td>
              <td data-value-type="number" data-decimals="1" style="font-weight:bold;">=SUM(R[-3]C:R[-1]C)</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">GPA (Total QP / Credits)</td>
              <td data-value-type="number" data-decimals="2" style="font-weight:bold; color:blue;">=R[-1]C/R[-1]C[-2]</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'home',
      icon: 'home',
      title: 'Chore Tracker (Home)',
      desc: 'Assign chores and calculate allowance.',
      html: `
        <table class="calculeaf-table tbl-theme-accent" style="width: 100%;">
          <thead>
            <tr>
              <th>Chore</th>
              <th>Assignee</th>
              <th>Done (0 or 1)</th>
              <th>Reward</th>
              <th>Earned</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Mow Lawn</td><td>Alex</td><td data-value-type="number" data-decimals="0">1</td><td data-value-type="currency" data-currency="$" data-decimals="2">15</td><td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td></tr>
            <tr><td>Wash Dishes</td><td>Alex</td><td data-value-type="number" data-decimals="0">0</td><td data-value-type="currency" data-currency="$" data-decimals="2">5</td><td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td></tr>
            <tr><td>Vacuum</td><td>Sam</td><td data-value-type="number" data-decimals="0">1</td><td data-value-type="currency" data-currency="$" data-decimals="2">10</td><td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]*RC[-1]</td></tr>
            <tr>
              <td colspan="4" style="text-align:right; font-weight:bold;">Alex Allowance</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=SUM(R[-3]C:R[-2]C)</td>
            </tr>
            <tr>
              <td colspan="4" style="text-align:right; font-weight:bold;">Sam Allowance</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=SUM(R[-3]C:R[-3]C)</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'lending',
      icon: 'landmark',
      title: 'Loan Tracker (Lending)',
      desc: 'Track borrowed items or personal loans.',
      html: `
        <table class="calculeaf-table tbl-theme-grayscale" style="width: 100%;">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Principal Amount</th>
              <th>Interest Rate</th>
              <th>Total Owed</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>John Doe</td><td data-value-type="currency" data-currency="$" data-decimals="2">1000</td><td data-value-type="percentage" data-decimals="1">0.05</td><td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]+(RC[-2]*RC[-1])</td></tr>
            <tr><td>Jane Smith</td><td data-value-type="currency" data-currency="$" data-decimals="2">500</td><td data-value-type="percentage" data-decimals="1">0.00</td><td data-value-type="currency" data-currency="$" data-decimals="2">=RC[-2]+(RC[-2]*RC[-1])</td></tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Total Capital Outstanding</td>
              <td data-value-type="currency" data-currency="$" data-decimals="2" style="font-weight:bold;">=SUM(R[-2]C:R[-1]C)</td>
            </tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'recipe',
      icon: 'utensils',
      title: 'Recipe Scaler',
      desc: 'Easily scale recipe ingredients by serving size.',
      html: `
        <table class="calculeaf-table tbl-theme-zebra" style="width: 100%;">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Base Qty (per serving)</th>
              <th>Servings</th>
              <th>Total Required</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="4" style="text-align:right;">Multiplier:</td><td data-value-type="number" data-decimals="1" id="servings">4</td></tr>
            <tr><td>Flour (cups)</td><td data-value-type="number" data-decimals="2">0.5</td><td></td><td data-value-type="number" data-decimals="2">=RC[-2]*R[-1]C[1]</td></tr>
            <tr><td>Sugar (tbsp)</td><td data-value-type="number" data-decimals="2">1</td><td></td><td data-value-type="number" data-decimals="2">=RC[-2]*R[-2]C[1]</td></tr>
            <tr><td>Eggs</td><td data-value-type="number" data-decimals="1">0.5</td><td></td><td data-value-type="number" data-decimals="2">=RC[-2]*R[-3]C[1]</td></tr>
          </tbody>
        </table>
      `
  },
  {
      id: 'agenda',
      icon: 'calendar-days',
      title: 'Meeting Agenda',
      desc: 'Plan meetings and allocate time blocks.',
      html: `
        <table class="calculeaf-table tbl-theme-elegant" style="width: 100%;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Topic</th>
              <th>Presenter</th>
              <th>Duration (Mins)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>10:00 AM</td><td>Welcome & Intros</td><td>Host</td><td data-value-type="number" data-decimals="0">5</td></tr>
            <tr><td>10:05 AM</td><td>Q3 Financial Review</td><td>CFO</td><td data-value-type="number" data-decimals="0">20</td></tr>
            <tr><td>10:25 AM</td><td>Marketing Update</td><td>CMO</td><td data-value-type="number" data-decimals="0">15</td></tr>
            <tr><td>10:40 AM</td><td>Q&A</td><td>All</td><td data-value-type="number" data-decimals="0">10</td></tr>
            <tr>
              <td colspan="3" style="text-align:right; font-weight:bold;">Total Meeting Time</td>
              <td data-value-type="number" data-decimals="0" style="font-weight:bold;">=SUM(R[-4]C:R[-1]C)</td>
            </tr>
          </tbody>
        </table>
      `
  }
];

function renderTemplatesGrid() {
  const grid = document.getElementById('templateGrid');
  if(!grid) return;
  
  let html = '';
  TABLE_TEMPLATES.forEach(t => {
      html += `
        <div class="template-card" onclick="insertTableTemplate('${t.id}')">
          <div class="tc-icon"><i data-lucide="${t.icon}"></i></div>
          <div class="tc-info">
            <div class="tc-title">${t.title}</div>
            <div class="tc-desc">${t.desc}</div>
          </div>
        </div>
      `;
  });
  grid.innerHTML = html;
  if(window.lucide) window.lucide.createIcons({root: grid});
}

function insertTableTemplate(id) {
  const template = TABLE_TEMPLATES.find(t => t.id === id);
  if(!template) return;
  
  const ed = bodyEl();
  if(!ed) return;
  
  if(window.HistoryManager) window.HistoryManager.capture(true);
  
  // Wrap in table-wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper table-calculeaf-ready';
  wrapper.contentEditable = 'false';
  
  const block = document.createElement('div');
  block.className = 'table-block';
  block.innerHTML = template.html;
  
  wrapper.appendChild(block);
  
  // Insert logic
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      let anchor = range.startContainer;
      if (anchor.nodeType === 3) anchor = anchor.parentNode;
      
      let topBlock = anchor;
      while (topBlock && topBlock.parentNode !== ed) {
          topBlock = topBlock.parentNode;
      }
      
      if (topBlock) {
          ed.insertBefore(wrapper, topBlock.nextSibling);
      } else {
          ed.appendChild(wrapper);
      }
  } else {
      ed.appendChild(wrapper);
  }
  
  document.getElementById('tblTemplateModal').classList.remove('show');
  
  if(window.HistoryManager) window.HistoryManager.capture(true);
  toast(`${template.title} inserted!`);
  
  // Wait a tick for DOM layout, then trigger calculations
  setTimeout(() => {
    const ev = new Event('input', { bubbles: true });
    wrapper.dispatchEvent(ev);
    recalcAllFormulaCellsInTable(wrapper.querySelector('table'));
  }, 100);
}
"""

if 'const TABLE_TEMPLATES =' not in content:
    content = content.replace("function insertFinancialTemplate(type){", templates_code + "\nfunction insertFinancialTemplate(type){")

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Templates JS Logic patched!')
