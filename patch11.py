import codecs

with codecs.open('app.html', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

start_idx = content.find('<!-- ============ TABLE QUICK TOOLBAR (fix #7) ============ -->')
end_idx = content.find('<!-- Cell Background Color Dropdown -->')

if start_idx != -1 and end_idx != -1:
    new_toolbar = """<!-- ============ TABLE QUICK TOOLBAR ============ -->
<div class="tbl-tools" id="tblTools">
  <button id="tblMoveHandle" class="tbl-move-handle" title="Move table" aria-label="Move table"><i data-lucide="grip-vertical" class="w-4 h-4"></i></button>
  <span class="tbl-dim-badge" id="tblDimBadge"></span>
  <span class="tbl-sep"></span>
  <button id="tblBtnMerge" title="Merge / Split"><i data-lucide="combine" class="w-4 h-4"></i></button>
  <button id="tblBtnLayout" title="Layout &amp; Margins"><i data-lucide="layout-grid" class="w-4 h-4"></i></button>
  <button id="tblBtnThemes" title="Table Themes"><i data-lucide="palette" class="w-4 h-4"></i></button>
  <button id="tblBtnTemplates" title="Templates"><i data-lucide="layout-template" class="w-4 h-4"></i></button>
  <span class="tbl-sep"></span>
  <button id="tblDel" class="danger" title="Delete table"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
  <button id="tblBtnMobileSheet" class="tbl-mobile-only" title="Table options" style="display:none"><i data-lucide="sliders-horizontal" class="w-4 h-4"></i></button>
</div>

<!-- ── Merge / Split submenu ── -->
<div class="tbl-submenu" id="tblMenuMerge">
  <button id="tblMergeCells"><i data-lucide="combine" class="w-4 h-4"></i>Merge Selected Cells</button>
  <button id="tblSplitCell"><i data-lucide="split" class="w-4 h-4"></i>Split Cell</button>
  <div class="tbl-sep"></div>
  <button id="tblMergeRow"><i data-lucide="minus" class="w-4 h-4"></i>Merge Across Row</button>
  <button id="tblMergeCol"><i data-lucide="chevrons-down" class="w-4 h-4"></i>Merge Down Column</button>
</div>

<!-- ── Layout submenu ── -->
<div class="tbl-submenu" id="tblMenuLayout">
  <button id="tblFitWindow"><i data-lucide="stretch-horizontal" class="w-4 h-4"></i>Fit to Window</button>
  <button id="tblFitContent"><i data-lucide="shrink" class="w-4 h-4"></i>Fit to Content</button>
  <button id="tblDistribute"><i data-lucide="columns" class="w-4 h-4"></i>Distribute Evenly</button>
  <button id="tblEqualRowH"><i data-lucide="align-vertical-distribute-center" class="w-4 h-4"></i>Equal Row Heights</button>
  <div class="tbl-sep"></div>
  <button id="tblValignTop"><i data-lucide="align-vertical-space-around" class="w-4 h-4"></i>Vertical Top</button>
  <button id="tblValignMiddle"><i data-lucide="align-vertical-justify-center" class="w-4 h-4"></i>Vertical Middle</button>
  <button id="tblValignBottom"><i data-lucide="align-vertical-justify-end" class="w-4 h-4"></i>Vertical Bottom</button>
  <div class="tbl-sep"></div>
  <div style="padding: 8px 12px; font-size: 13px; color: var(--fg-muted); display:flex; align-items:center; gap:8px;">
    <i data-lucide="maximize" class="w-4 h-4"></i> Cell Padding
    <input type="range" id="tblMarginSlider" min="0" max="24" value="8" style="width: 80px;">
  </div>
</div>

<!-- ── Themes submenu ── -->
<div class="tbl-submenu" id="tblMenuThemes">
  <div style="padding: 4px 12px; font-size: 11px; font-weight:600; text-transform:uppercase; color: var(--fg-muted);">Print Friendly</div>
  <button data-theme="default"><i data-lucide="printer" class="w-4 h-4"></i>Default (Ink Saver)</button>
  <button data-theme="grayscale"><i data-lucide="printer" class="w-4 h-4"></i>Grayscale Headers</button>
  
  <div class="tbl-sep"></div>
  <div style="padding: 4px 12px; font-size: 11px; font-weight:600; text-transform:uppercase; color: var(--fg-muted);">Aesthetic</div>
  <button data-theme="modern"><i data-lucide="monitor" class="w-4 h-4"></i>Modern Minimalist</button>
  <button data-theme="zebra"><i data-lucide="list" class="w-4 h-4"></i>Zebra Striped</button>
  <button data-theme="elegant"><i data-lucide="pen-tool" class="w-4 h-4"></i>Elegant Serif</button>
  <button data-theme="accent"><i data-lucide="paintbrush" class="w-4 h-4"></i>Accent Header</button>
  <button data-theme="dark"><i data-lucide="moon" class="w-4 h-4"></i>Dark Mode Pro</button>
</div>

<!-- ── Templates Modal ── -->
<div id="tblTemplateModal" role="dialog" aria-modal="true" aria-label="Table Templates" onclick="if(event.target===this)this.classList.remove('show')" class="template-modal-overlay">
  <div class="template-modal">
    <div class="template-modal-header">
      <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px;"><i data-lucide="layout-template"></i> Insert Table Template</h3>
      <button onclick="document.getElementById('tblTemplateModal').classList.remove('show')" style="background:none;border:none;cursor:pointer;color:var(--fg-muted);"><i data-lucide="x"></i></button>
    </div>
    <div class="template-grid" id="templateGrid">
      <!-- Injected via JS -->
    </div>
  </div>
</div>

"""
    content = content[:start_idx] + new_toolbar + content[end_idx:]
    with codecs.open('app.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('app.html toolbar patched!')
else:
    print('Failed to find replace boundaries.')
