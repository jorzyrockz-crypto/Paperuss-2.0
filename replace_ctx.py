with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\app.html', 'r', encoding='utf-8') as f:
    text = f.read()

start_tag = '<!-- Right-click context menu for table cells -->'
end_tag = '</div>\n\n  <!-- Block formatting'

start_idx = text.find(start_tag)
end_idx = text.find(end_tag, start_idx)

if start_idx != -1 and end_idx != -1:
    new_html = '''<!-- Right-click context menu for table cells -->
<div class="tbl-ctx-menu" id="tblCtxMenu">
  
  <div class="tbl-ctx-quick-bar">
    <div class="tbl-ctx-quick-row">
      <button class="tbl-ctx-quick-btn" data-ctx="tblBold" title="Bold (Ctrl+B)"><i data-lucide="bold"></i></button>
      <button class="tbl-ctx-quick-btn" data-ctx="tblItalic" title="Italic (Ctrl+I)"><i data-lucide="italic"></i></button>
      <button class="tbl-ctx-quick-btn" data-ctx="tblAlign" title="Align"><i data-lucide="align-left"></i></button>
      <button class="tbl-ctx-quick-btn" data-ctx="tblWrap" title="Wrap Text"><i data-lucide="wrap-text"></i></button>
      <div class="tbl-ctx-quick-btn has-submenu">
        <button title="Border Style"><i data-lucide="border-all"></i></button>
        <div class="tbl-ctx-submenu">
          <button data-ctx="tblBorderAll"><i data-lucide="border-all" class="w-4 h-4"></i> All Borders</button>
          <button data-ctx="tblBorderOutline"><i data-lucide="square" class="w-4 h-4"></i> Outline</button>
          <button data-ctx="tblBorderNone"><i data-lucide="x-square" class="w-4 h-4"></i> No Border</button>
        </div>
      </div>
      <button class="tbl-ctx-quick-btn" data-ctx="tblFillColor" title="Fill Color"><i data-lucide="paint-bucket"></i></button>
    </div>
    <div class="tbl-ctx-quick-row">
      <div class="tbl-ctx-quick-btn has-submenu">
        <button title="Currency Format"><i data-lucide="dollar-sign"></i></button>
        <div class="tbl-ctx-submenu">
          <button data-ctx="tblFmtCurUSD">$ (USD)</button>
          <button data-ctx="tblFmtCurEUR">€ (EUR)</button>
          <button data-ctx="tblFmtCurGBP">£ (GBP)</button>
        </div>
      </div>
      <button class="tbl-ctx-quick-btn" data-ctx="tblFmtPercent" title="Percent Format"><i data-lucide="percent"></i></button>
      <button class="tbl-ctx-quick-btn" data-ctx="tblFmtComma" style="font-family:serif;font-weight:bold;font-size:16px;" title="Comma Format">,</button>
      <button class="tbl-ctx-quick-btn" style="font-size:11px;font-weight:600;gap:1px;" data-ctx="tblFmtDecInc" title="Increase Decimal"><i data-lucide="arrow-left-to-line" style="width:12px;height:12px"></i>.0</button>
      <button class="tbl-ctx-quick-btn" style="font-size:11px;font-weight:600;gap:1px;" data-ctx="tblFmtDecDec" title="Decrease Decimal">.0<i data-lucide="arrow-right-to-line" style="width:12px;height:12px"></i></button>
    </div>
  </div>

  <div class="tbl-ctx-sep"></div>

  <button class="tbl-ctx-item" data-ctx="tblCut"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="scissors" class="w-4 h-4"></i>Cut</div><span class="ctx-shortcut">Ctrl+X</span></button>
  <button class="tbl-ctx-item" data-ctx="tblCopy"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="copy" class="w-4 h-4"></i>Copy</div><span class="ctx-shortcut">Ctrl+C</span></button>
  <button class="tbl-ctx-item" data-ctx="tblPaste"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="clipboard" class="w-4 h-4"></i>Paste</div><span class="ctx-shortcut">Ctrl+V</span></button>
  <button class="tbl-ctx-item" data-ctx="tblPasteVal"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="clipboard-paste" class="w-4 h-4"></i>Paste Values Only</div></button>
  <button class="tbl-ctx-item" data-ctx="tblFmtPaint"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="paintbrush" class="w-4 h-4"></i>Format Painter</div></button>

  <div class="tbl-ctx-sep"></div>

  <button class="tbl-ctx-item danger" data-ctx="tblClearCell"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="eraser" class="w-4 h-4"></i>Clear Contents</div><span class="ctx-shortcut">Del</span></button>
  <button class="tbl-ctx-item" data-ctx="tblClearFmt"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="remove-formatting" class="w-4 h-4"></i>Clear Formatting</div></button>

  <div class="tbl-ctx-sep" id="tblCtxMergeSep" style="display:none"></div>

  <button class="tbl-ctx-item" id="tblCtxMerge" data-ctx="tblMergeCells" style="display:none"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="combine" class="w-4 h-4"></i>Merge Selected Cells</div></button>
  <button class="tbl-ctx-item" id="tblCtxSplit" data-ctx="tblSplitCell" style="display:none"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="split" class="w-4 h-4"></i>Split Cell</div></button>

  <div class="tbl-ctx-sep"></div>

  <div class="tbl-ctx-item has-submenu">
    <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="calendar" class="w-4 h-4"></i>Format as Date</div>
    <i data-lucide="chevron-right" class="w-4 h-4 ctx-submenu-arrow"></i>
    <div class="tbl-ctx-submenu right-submenu">
      <button data-ctx="tblDateShort">Short Date (YYYY-MM-DD)</button>
      <button data-ctx="tblDateLong">Long Date (Month D, YYYY)</button>
      <button data-ctx="tblDateNum">Numeric (MM/DD/YYYY)</button>
      <button data-ctx="tblDateISO">ISO Standard (YYYY-MM-DD)</button>
    </div>
  </div>

  <div class="tbl-ctx-item has-submenu">
    <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="list-filter" class="w-4 h-4"></i>Filter and Sort</div>
    <i data-lucide="chevron-right" class="w-4 h-4 ctx-submenu-arrow"></i>
    <div class="tbl-ctx-submenu right-submenu">
      <button data-ctx="tblSortAsc"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="arrow-down-a-z" class="w-4 h-4"></i>Sort Range (A to Z)</div></button>
      <button data-ctx="tblSortDesc"><div style="display:flex;align-items:center;gap:8px;"><i data-lucide="arrow-down-z-a" class="w-4 h-4"></i>Sort Range (Z to A)</div></button>
    </div>
  </div>
'''
    text = text[:start_idx] + new_html + text[end_idx:]
    with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\app.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced tblCtxMenu HTML in app.html")
else:
    print("Could not find start or end tags")
