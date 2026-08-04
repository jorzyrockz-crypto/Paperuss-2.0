/* ============================================================
   CALENDAR VIEW
   ============================================================ */
const CAL_VIEW_NAMES={day:'Day',week:'Week',month:'Month',schedule:'Schedule'};

function dayStart(ts){const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime();}
function dayEnd(ts){const d=new Date(ts);d.setHours(23,59,59,999);return d.getTime();}
function sameCalendarDay(a,b){return dayStart(a)===dayStart(b);}
function persistCalendarState(){
  localStorage.setItem('octonotes:calendarView',state.calendarView);
  localStorage.setItem('octonotes:calendarSelectedDate',String(state.calendarSelectedDate));
  if(typeof markPortableStateChanged==='function') markPortableStateChanged();
}

/* Expand calendar notes into concrete occurrences inside a requested range. */
function calendarOccurrences(rangeStart,rangeEnd){
  const out=[];
  notes.forEach(n=>{
    if(n.deletedAt) return;
    if(!(n.tags||[]).includes('calendar')) return;
    let start=n.calendarStart||n.createdAt;
    let end=n.calendarEnd||start;
    if(end<start)[start,end]=[end,start];
    const duration=Math.max(0,end-start);
    const repeat=n.calendarRepeat||null;
    if(!repeat){
      if(end>=rangeStart&&start<=rangeEnd) out.push({note:n,start,end});
      return;
    }
    let cursor=new Date(start),guard=0;
    while(cursor.getTime()<=rangeEnd&&guard++<500){
      const occStart=cursor.getTime(),occEnd=occStart+duration;
      if(occEnd>=rangeStart) out.push({note:n,start:occStart,end:occEnd});
      const next=new Date(cursor);
      if(repeat==='daily')next.setDate(next.getDate()+1);
      else if(repeat==='weekly')next.setDate(next.getDate()+7);
      else if(repeat==='monthly')next.setMonth(next.getMonth()+1);
      else if(repeat==='yearly')next.setFullYear(next.getFullYear()+1);
      else break;
      cursor=next;
    }
  });
  return out.sort((a,b)=>a.start-b.start);
}

function selectCalendarDate(ts){
  state.calendarSelectedDate=dayStart(ts);
  const d=new Date(ts);state.calendarYear=d.getFullYear();state.calendarMonth=d.getMonth();
  persistCalendarState();
  renderCalendarView();
  renderCalendarPlannerList();
  // On phones, reveal the Event / Planner column after a date is chosen.
  if(window.innerWidth<=640) showMobileList();
}

function renderCalendarPlannerList(){
  const c=document.getElementById('notesContainer');
  const title=document.getElementById('listTitle');
  if(!c||!title)return;
  const ts=state.calendarSelectedDate||Date.now();
  const date=new Date(ts);
  title.textContent=date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const occ=calendarOccurrences(dayStart(ts),dayEnd(ts));
  const datedNotes=notes.filter(n=>!n.deletedAt&&!(n.tags||[]).includes('calendar')&&(sameCalendarDay(n.createdAt,ts)||sameCalendarDay(n.updatedAt,ts)));
  const dueTasks=standaloneTasks.filter(t=>t.due&&sameCalendarDay(t.due,ts));
  let html='';
  occ.forEach(({note,start})=>{
    html+=`<div class="note-card ${note.id===state.currentId?'active':''}" data-id="${note.id}">
      <div class="note-title"><i data-lucide="calendar" class="w-4 h-4 text-accent"></i>${esc(titleOf(note))}</div>
      <div class="note-preview">${esc(stripHtml(note.content||'').slice(0,120))}</div>
      <div class="note-meta"><span>${new Date(start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span>${(note.tags||[]).slice(1,3).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>`;
  });
  dueTasks.forEach(t=>{
    html+=`<div class="note-card" onclick="state.filter='tasks';state.taskFilter='today';renderAll();showMobileEditor()">
      <div class="note-title"><i data-lucide="check-square" class="w-4 h-4 text-accent"></i>${esc(t.text)}</div>
      <div class="note-meta"><span>${new Date(t.due).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span><span class="chip">Task</span>${t.completed?'<span class="chip">Completed</span>':''}</div>
    </div>`;
  });
  datedNotes.forEach(n=>{
    html+=`<div class="note-card ${n.id===state.currentId?'active':''}" data-id="${n.id}"><div class="note-title"><i data-lucide="file-text" class="w-4 h-4 text-accent"></i>${esc(titleOf(n))}</div><div class="note-preview">${esc(stripHtml(n.content||'').slice(0,120))}</div><div class="note-meta"><span>Note / Journal</span></div></div>`;
  });
  if(!html)html=`<div class="list-empty"><i data-lucide="calendar-check" style="width:30px;height:30px;margin:0 auto 10px;opacity:.45"></i>No items for this date.<br>Select the date, then use Add Event.</div>`;
  c.innerHTML=html;refreshIcons();
}

function renderCalendarView(){
  if(!['day','week','month','schedule'].includes(state.calendarView))state.calendarView='month';
  const select=document.getElementById('calViewSelect');
  if(select)select.value=state.calendarView||'month';
  persistCalendarState();
  if(state.calendarView==='day')return renderCalendarDayView();
  if(state.calendarView==='week')return renderCalendarWeekView();
  if(state.calendarView==='schedule')return renderCalendarScheduleView();
  return renderCalendarMonthView();
}

function renderCalendarMonthView(){
  const calGrid=document.getElementById('calGrid');
  const calTitle=document.getElementById('calMonthTitle');
  const weekdays=document.getElementById('calWeekdays');
  if(!calGrid || !calTitle) return;
  calGrid.className='cal-grid';
  if(weekdays)weekdays.style.display='grid';

  const year=state.calendarYear;
  const month=state.calendarMonth;
  const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
  calTitle.textContent=`${monthNames[month]} ${year}`;

  const firstDay=new Date(year, month, 1).getDay();
  const daysInMonth=new Date(year, month + 1, 0).getDate();
  const today=new Date();
  const monthStart=new Date(year, month, 1).getTime();
  const monthEnd=new Date(year, month, daysInMonth, 23, 59, 59, 999).getTime();

  // Build a map: day → notes
  const dayMap={};
  notes.forEach(n=>{
    if(n.deletedAt) return;
    const isCalendarNote = (n.tags||[]).includes('calendar');
    if(!isCalendarNote) return;

    // Use structured metadata if available, else fallback to createdAt/updatedAt
    let eventStart=n.calendarStart||n.createdAt;
    let eventEnd=n.calendarEnd||n.updatedAt;
    if(eventStart>eventEnd){ const tmp=eventStart; eventStart=eventEnd; eventEnd=tmp; }

    // Handle recurring events
    const repeatVal=n.calendarRepeat||null;
    if(repeatVal){
      // Expand recurrences within the visible month
      let cursor=new Date(eventStart);
      while(cursor.getTime()<=monthEnd){
        const cy=cursor.getFullYear(), cm=cursor.getMonth(), cd=cursor.getDate();
        if(cy===year && cm===month && cd>=1 && cd<=daysInMonth){
          if(!dayMap[cd]) dayMap[cd]=[];
          if(!dayMap[cd].find(x=>x.id===n.id)) dayMap[cd].push(n);
        }
        // Advance cursor by recurrence rule
        const next=new Date(cursor);
        if(repeatVal==='daily') next.setDate(cursor.getDate()+1);
        else if(repeatVal==='weekly') next.setDate(cursor.getDate()+7);
        else if(repeatVal==='monthly') next.setMonth(cursor.getMonth()+1);
        else if(repeatVal==='yearly') next.setFullYear(cursor.getFullYear()+1);
        else break;
        cursor=next;
        // Safety: max 500 iterations
        if(cursor.getTime()-eventStart > 1000*86400*3660) break;
      }
    } else {
      // Non-recurring: add every day from start to end
      const s=new Date(eventStart); s.setHours(0,0,0,0);
      const e=new Date(eventEnd); e.setHours(23,59,59,999);
      for(let d=new Date(s); d<=e && d<=new Date(monthEnd); d.setDate(d.getDate()+1)){
        const dy=d.getFullYear(), dm=d.getMonth(), dd=d.getDate();
        if(dy===year && dm===month && dd>=1 && dd<=daysInMonth){
          if(!dayMap[dd]) dayMap[dd]=[];
          if(!dayMap[dd].find(x=>x.id===n.id)) dayMap[dd].push(n);
        }
      }
    }
  });

  let cellsHtml='';
  for(let i=0; i<firstDay; i++){
    cellsHtml+=`<div class="cal-cell cal-empty"></div>`;
  }

  for(let day=1; day<=daysInMonth; day++){
    const isToday=(day===today.getDate() && month===today.getMonth() && year===today.getFullYear());
    const dayNotes=dayMap[day]||[];
    const pillLimit=3;

    let pillsHtml='';
    dayNotes.slice(0, pillLimit).forEach(n=>{
      const hasMeta=n.calendarStart;
      const repeatVal=n.calendarRepeat||(n.tags||[]).find(t=>t.startsWith('repeat-'));
      const recLabel=repeatVal?` · 🔁 ${repeatVal.replace('repeat-','')}`:'';
      const eventTypeIcon=n.tags.some(t=>t==='meeting')?'users':(n.tags.some(t=>t==='deadline')?'alarm-clock':(n.tags.some(t=>t.startsWith('repeat-'))?'refresh-cw':'calendar'));
      pillsHtml+=`<div class="cal-note-pill" onclick="event.stopPropagation(); selectCalendarDate(${new Date(year,month,day).getTime()})" title="${esc(titleOf(n))}${recLabel}">
        <i data-lucide="${eventTypeIcon}" class="w-3 h-3 inline mr-1"></i>${esc(titleOf(n))}
      </div>`;
    });
    if(dayNotes.length>pillLimit){
      pillsHtml+=`<div class="cal-note-pill" style="background:rgba(148,163,184,.15);color:var(--fg-secondary);font-weight:600" onclick="event.stopPropagation(); selectCalendarDate(${new Date(year,month,day).getTime()})">
        +${dayNotes.length-pillLimit} more
      </div>`;
    }

    const cellTs=new Date(year,month,day).getTime();
    const selected=sameCalendarDay(cellTs,state.calendarSelectedDate);
    cellsHtml+=`<div class="cal-cell ${isToday?'cal-today':''} ${selected?'cal-selected':''}" onclick="selectCalendarDate(${cellTs})" ondblclick="openCalendarEventCreator(${year}, ${month}, ${day})" title="Click to select · Double-click to add an event">
      <div class="cal-day-num">${day}</div>
      ${pillsHtml}
    </div>`;
  }

  calGrid.innerHTML=cellsHtml;
  refreshIcons();
}

function renderCalendarDayView(){
  const grid=document.getElementById('calGrid'),title=document.getElementById('calMonthTitle'),weekdays=document.getElementById('calWeekdays');
  if(!grid||!title)return;
  if(weekdays)weekdays.style.display='none';grid.className='cal-grid cal-day-view';
  const ts=state.calendarSelectedDate||Date.now(),d=new Date(ts);
  title.textContent=d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const occ=calendarOccurrences(dayStart(ts),dayEnd(ts));
  let html=`<div class="cal-day-head"><strong>${d.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</strong><button class="btn btn-primary" onclick="openCalendarEventCreator(${d.getFullYear()},${d.getMonth()},${d.getDate()})"><i data-lucide="plus" class="w-4 h-4"></i> Event</button></div>`;
  for(let hour=0;hour<24;hour++){
    const events=occ.filter(o=>new Date(o.start).getHours()===hour);
    html+=`<div class="cal-hour-row"><div class="cal-hour-label">${new Date(2000,0,1,hour).toLocaleTimeString(undefined,{hour:'numeric'})}</div><div class="cal-hour-slot" ondblclick="openCalendarEventCreator(${d.getFullYear()},${d.getMonth()},${d.getDate()})">${events.map(o=>`<div class="cal-time-event" onclick="event.stopPropagation();selectCalendarDate(${ts})"><span>${new Date(o.start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span>${esc(titleOf(o.note))}</div>`).join('')}</div></div>`;
  }
  grid.innerHTML=html;refreshIcons();
}

function weekStartFor(ts){const d=new Date(ts);d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d;}
function renderCalendarWeekView(){
  const grid=document.getElementById('calGrid'),title=document.getElementById('calMonthTitle'),weekdays=document.getElementById('calWeekdays');
  if(!grid||!title)return;
  if(weekdays)weekdays.style.display='none';grid.className='cal-grid cal-week-view';
  const start=weekStartFor(state.calendarSelectedDate||Date.now()),end=new Date(start);end.setDate(end.getDate()+6);end.setHours(23,59,59,999);
  title.textContent=`${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;
  const occ=calendarOccurrences(start.getTime(),end.getTime()),today=Date.now();
  let html='<div class="cal-week-grid">';
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(d.getDate()+i);const ts=d.getTime();const items=occ.filter(o=>sameCalendarDay(o.start,ts));
    html+=`<div class="cal-week-day ${sameCalendarDay(ts,today)?'today':''} ${sameCalendarDay(ts,state.calendarSelectedDate)?'selected':''}" onclick="selectCalendarDate(${ts})" ondblclick="openCalendarEventCreator(${d.getFullYear()},${d.getMonth()},${d.getDate()})"><div class="cal-week-date">${d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</div>${items.map(o=>`<div class="cal-week-event" title="${esc(titleOf(o.note))}">${new Date(o.start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})} ${esc(titleOf(o.note))}</div>`).join('')}</div>`;
  }
  grid.innerHTML=html+'</div>';refreshIcons();
}

function renderCalendarScheduleView(){
  const grid=document.getElementById('calGrid'),title=document.getElementById('calMonthTitle'),weekdays=document.getElementById('calWeekdays');
  if(!grid||!title)return;
  if(weekdays)weekdays.style.display='none';grid.className='cal-grid cal-schedule-view';
  const start=dayStart(state.calendarSelectedDate||Date.now()),end=start+90*86400000;
  title.textContent='Schedule';
  const occ=calendarOccurrences(start,end),groups=new Map();
  occ.forEach(o=>{const key=dayStart(o.start);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);});
  let html='';
  groups.forEach((items,ts)=>{
    const d=new Date(ts);let label=d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    if(sameCalendarDay(ts,Date.now()))label='Today · '+label;
    else if(sameCalendarDay(ts,Date.now()+86400000))label='Tomorrow · '+label;
    html+=`<section class="cal-agenda-group"><div class="cal-agenda-date" onclick="selectCalendarDate(${ts})">${label}</div>${items.map(o=>`<div class="cal-agenda-item" onclick="selectCalendarDate(${ts})"><div class="cal-agenda-time">${new Date(o.start).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</div><div><div class="cal-agenda-title">${esc(titleOf(o.note))}</div><div class="note-meta">${esc(stripHtml(o.note.content||'').slice(0,100))}</div></div></div>`).join('')}</section>`;
  });
  grid.innerHTML=html||'<div class="list-empty">No upcoming events in the next 90 days.</div>';refreshIcons();
}

async function openCalendarEventCreator(year, month, day, options){
  options = options || {};
  const intent = options.intent || 'calendar';
  const now = new Date();
  if(!year) year = now.getFullYear();
  if(month === undefined) month = now.getMonth();
  if(day === undefined) day = now.getDate();

  const dateLabel=new Date(year, month, day).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
  const root=document.getElementById('modalRoot');

  let activeTab = 'select';
  let selectedEventNoteId = null;
  let loadedEvents = [];
  let isLoading = true;
  let errorState = null;
  let isCreatingEvent = false;

  async function performLoad() {
    isLoading = true;
    errorState = null;
    renderModalContent();
    try {
      if(typeof load === 'function') await Promise.resolve(load());
      
      loadedEvents = [];
      notes.forEach(n => {
        if(n.deletedAt) return;
        if(!(n.tags||[]).includes('calendar')) return;
        
        let eventStart=n.calendarStart||n.createdAt;
        let eventEnd=n.calendarEnd||n.updatedAt;
        if(eventStart>eventEnd){ const tmp=eventStart; eventStart=eventEnd; eventEnd=tmp; }
        
        if(eventStart) loadedEvents.push({note: n, start: eventStart});
      });
      loadedEvents.sort((a,b)=>b.start - a.start);
      
    } catch(e) {
      errorState = e.message || 'Failed to load calendar events';
    }
    isLoading = false;
    renderModalContent();
  }

  function renderModalContent() {
    const hasEvents = loadedEvents.length > 0;
    if(!isLoading && !hasEvents && activeTab === 'select') activeTab = 'create';

    root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:500px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0">📅 Calendar Events & Planner</h3>
      </div>

      <div class="modal-tabs">
        <button type="button" class="modal-tab-btn ${activeTab==='select'?'active':''}" id="tabSelectEv" ${isLoading?'disabled':''}>
          <i data-lucide="calendar" class="w-4 h-4"></i> Select Existing (${isLoading ? '…' : loadedEvents.length})
        </button>
        <button type="button" class="modal-tab-btn ${activeTab==='create'?'active':''}" id="tabCreateEv" ${isLoading?'disabled':''}>
          <i data-lucide="plus-circle" class="w-4 h-4"></i> Create New
        </button>
      </div>

      ${activeTab === 'select' ? `
        <input id="evSearchInput" class="modal-search-input" placeholder="Search calendar events…" value="" ${isLoading?'disabled':''}>
        <div class="modal-item-list" id="evList" role="listbox">
          ${renderEventListRows('')}
        </div>
        <div class="modal-actions">
          <button class="btn" id="evCancel">Cancel</button>
          <button class="btn btn-primary" id="evInsertSelected" ${!selectedEventNoteId||isLoading?'disabled':''}>Insert Selected Event</button>
        </div>
      ` : `
        <p style="font-size:12.5px;color:var(--fg-secondary);margin-bottom:12px">${dateLabel}</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          <input id="evTitle" placeholder="Event title" value="" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;outline:none;color:var(--fg)">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="evStartDate" type="date" value="${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px" title="Start date">
            <input id="evStartTime" type="time" value="09:00" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px" title="Start time">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="evEndDate" type="date" value="${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px" title="End date">
            <input id="evEndTime" type="time" value="10:00" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px" title="End time">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="evType" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:110px">
              <option value="event">🗓️ General Event</option>
              <option value="meeting">👥 Meeting</option>
              <option value="deadline">⏰ Deadline</option>
              <option value="planner">📝 Planner Note</option>
            </select>
            <select id="evRepeat" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px">
              <option value="none">🔁 Does not repeat</option>
              <option value="daily">🔄 Every day</option>
              <option value="weekly">📅 Every week</option>
              <option value="monthly">📆 Every month</option>
              <option value="yearly">🗓️ Every year</option>
            </select>
          </div>
          <textarea id="evDesc" placeholder="Optional description…" rows="2" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;outline:none;color:var(--fg);resize:vertical"></textarea>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg-secondary);cursor:pointer">
            <input type="checkbox" id="evNotify" checked> Notify me when this event starts
          </label>
          <small style="color:var(--fg-muted);line-height:1.4">Reminder checks run while PapeRuss is open.</small>
        </div>
        <div class="modal-actions">
          <button class="btn" id="evCancel">Cancel</button>
          <button class="btn btn-primary" id="evCreate">${intent === 'insert' ? 'Create & Insert Event' : 'Create Event'}</button>
        </div>
      `}
    </div></div>`;

    if(typeof refreshIcons === 'function') refreshIcons();

    const close=()=>root.innerHTML='';
    const cancelBtn = document.getElementById('evCancel');
    if(cancelBtn) cancelBtn.onclick=close;
    const overlay = root.querySelector('.modal-overlay');
    if(overlay) overlay.onclick=e=>{ if(e.target===e.currentTarget) close(); };

    const btnTabSel = document.getElementById('tabSelectEv');
    const btnTabCre = document.getElementById('tabCreateEv');
    if(btnTabSel) btnTabSel.onclick = () => { activeTab = 'select'; renderModalContent(); };
    if(btnTabCre) btnTabCre.onclick = () => { activeTab = 'create'; renderModalContent(); };

    if(activeTab === 'select') {
      const searchInput = document.getElementById('evSearchInput');
      if(searchInput) {
        searchInput.oninput = (e) => {
          const listEl = document.getElementById('evList');
          if(listEl) listEl.innerHTML = renderEventListRows(e.target.value);
        };
      }
      const listEl = document.getElementById('evList');
      if(listEl) {
        listEl.onclick = (e) => {
          const row = e.target.closest('[data-item-id]');
          if(!row) return;
          selectedEventNoteId = String(row.getAttribute('data-item-id'));
          
          listEl.querySelectorAll('[data-item-id]').forEach(r => {
            const isSel = String(r.getAttribute('data-item-id')) === selectedEventNoteId;
            r.classList.toggle('selected', isSel);
            r.setAttribute('aria-selected', isSel);
          });
          const btn = document.getElementById('evInsertSelected');
          if(btn) btn.disabled = !selectedEventNoteId;
        };
        
        listEl.onkeydown = (e) => {
          if(e.key === 'Enter' || e.key === ' ') {
            const row = e.target.closest('[data-item-id]');
            if(row) {
              e.preventDefault();
              row.click();
            }
          }
        };
      }

      const btnInsertSel = document.getElementById('evInsertSelected');
      if(btnInsertSel) {
        btnInsertSel.onclick = () => {
          if(!selectedEventNoteId) { toast('Select an event first'); return; }
          const evObj = loadedEvents.find(e => e.note.id === selectedEventNoteId);
          if(!evObj) { toast('Selected event no longer exists in canonical store'); return; }

          window.insertProductivityReference('calendar', selectedEventNoteId);
          toast(`Inserted event "${titleOf(evObj.note)}" into note`);
          close();
        };
      }
    } else {
      document.getElementById('evCreate').onclick=async ()=>{
        if(isCreatingEvent) return;
        const btn=document.getElementById('evCreate');
        
        const titleEl=document.getElementById('evTitle');
        const startDateEl=document.getElementById('evStartDate');
        const startTimeEl=document.getElementById('evStartTime');
        const endDateEl=document.getElementById('evEndDate');
        const endTimeEl=document.getElementById('evEndTime');
        const typeEl=document.getElementById('evType');
        const repeatEl=document.getElementById('evRepeat');
        const descEl=document.getElementById('evDesc');
        const notifyEl=document.getElementById('evNotify');
        const title=titleEl.value.trim()||'Untitled Event';
        const startTimeStr=startTimeEl.value||'09:00';
        const startDateVal=startDateEl.value||`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const startTs=new Date(startDateVal+'T'+startTimeStr+':00').getTime();
        const endDateVal=endDateEl.value||startDateVal;
        const endTimeStr=endTimeEl.value||'10:00';
        const endTs=new Date(endDateVal+'T'+endTimeStr+':00').getTime();
        const type=typeEl.value;
        const repeatVal=repeatEl.value;
        const notify=notifyEl.checked;
        if(!Number.isFinite(startTs)||!Number.isFinite(endTs)){ toast('Enter valid event dates and times'); return; }
        if(endTs<startTs){ toast('Event end must be after its start'); return; }
        
        isCreatingEvent = true;
        btn.disabled = true;
        
        let tags=['calendar'];
        if(type==='meeting') tags.push('meeting');
        if(type==='deadline') tags.push('deadline');
        if(type==='planner') tags.push('planner');
        if(repeatVal!=='none'){ tags.push('recurring'); tags.push('repeat-'+repeatVal); }
        const startFmt=new Date(startTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        const endFmt=new Date(endTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        const safeDescription=esc(descEl.value.trim());
        const content_html=(typeof sanitizeNoteHTML==='function')?sanitizeNoteHTML(`<p><strong>📅 ${esc(startFmt)}</strong></p><p>→ ${esc(endFmt)}</p>${repeatVal!=='none'?`<p>🔁 Repeats: ${esc(repeatVal)}</p>`:''}${safeDescription?`<p>${safeDescription}</p>`:''}`):`<p><strong>📅 ${esc(startFmt)}</strong></p><p>→ ${esc(endFmt)}</p>${repeatVal!=='none'?`<p>🔁 Repeats: ${esc(repeatVal)}</p>`:''}${safeDescription?`<p>${safeDescription}</p>`:''}`;

        const newId=typeof uid==='function'?uid():Date.now().toString();
        const n={
          id:newId, title, content: content_html, tags, pinned:false, archived:false,
          createdAt:Date.now(), updatedAt:Date.now(), fontStyle:'sans',
          calendarStart:startTs, calendarEnd:endTs,
          calendarRepeat:repeatVal==='none'?null:repeatVal,
          calendarNotify:notify, calendarLastNotifiedAt:null,
          calendarDescription:descEl.value.trim()
        };
        notes.unshift(n);
        save();
        if(notify && typeof scheduleEventNotification==='function') scheduleEventNotification(n);
        if(typeof addNotification==='function'){
          addNotification({type:'calendar',title:'Event Created: '+title,body:startFmt,icon:'calendar',activity:true});
        }
        renderCalendarView(); renderAll();
        
        if(intent === 'insert') {
          window.insertProductivityReference('calendar', newId);
          toast(`Inserted event "${title}" into note`);
        }
        
        close();
      };
    }
  }

  function renderEventListRows(query) {
    if(isLoading) return `<div style="padding:16px;text-align:center;color:var(--fg-muted);font-size:13px"><i class="w-4 h-4 spinner" style="border:2px solid;border-right-color:transparent;border-radius:50%;width:14px;height:14px;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px"></i>Loading...</div>`;
    if(errorState) return `<div style="padding:16px;text-align:center;color:var(--danger);font-size:13px">${esc(errorState)}</div>`;
    
    const q = query.toLowerCase().trim();
    const filtered = loadedEvents.filter(e => !q || titleOf(e.note).toLowerCase().includes(q));
    if(!filtered.length) return `<div class="list-empty" style="padding:16px;text-align:center;color:var(--fg-muted);font-size:13px">No calendar events found.</div>`;

    return filtered.map(ev => {
      const isSel = selectedEventNoteId === ev.note.id;
      const title = titleOf(ev.note);
      const startFmt = new Date(ev.start).toLocaleString(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
      return `<div class="modal-item-row ${isSel?'selected':''}" data-item-id="${ev.note.id}" tabindex="0" role="option" aria-selected="${isSel}">
        <i data-lucide="calendar" class="w-4 h-4" style="color:var(--accent)"></i>
        <div style="flex:1;font-size:13px;font-weight:600;color:var(--fg)">${esc(title)}</div>
        <span style="font-size:11px;color:var(--fg-muted);background:var(--hover);padding:2px 6px;border-radius:4px">${startFmt}</span>
      </div>`;
    }).join('');
  }

  performLoad();
}

const eventNotifTimers=new Map();
const EVENT_TIMER_MAX_DELAY=6*60*60*1000;
function nextEventOccurrenceStart(note,after=Date.now()){
  const start=Number(note?.calendarStart);
  if(!Number.isFinite(start)) return null;
  const repeat=note.calendarRepeat;
  if(!repeat) return start>=after?start:null;
  let cursor=new Date(start),guard=0;
  while(cursor.getTime()<after && guard++<5000){
    const next=new Date(cursor);
    if(repeat==='daily') next.setDate(next.getDate()+1);
    else if(repeat==='weekly') next.setDate(next.getDate()+7);
    else if(repeat==='monthly') next.setMonth(next.getMonth()+1);
    else if(repeat==='yearly') next.setFullYear(next.getFullYear()+1);
    else return null;
    if(next.getTime()<=cursor.getTime()) return null;
    cursor=next;
  }
  return cursor.getTime();
}
function scheduleEventNotification(note,after=Date.now()-5000){
  cancelEventTimers(note?.id);
  const current=getNote(note?.id)||note;
  if(!current?.id || !current.calendarNotify || appSettings?.notifEvents===false) return;
  const occurrence=nextEventOccurrenceStart(current,after);
  if(!occurrence || current.calendarLastNotifiedAt===occurrence) return;
  const delay=occurrence-Date.now();
  if(delay>EVENT_TIMER_MAX_DELAY){
    eventNotifTimers.set(current.id,setTimeout(()=>scheduleEventNotification(current),EVENT_TIMER_MAX_DELAY));
    return;
  }
  const timer=setTimeout(()=>{
    eventNotifTimers.delete(current.id);
    const latest=getNote(current.id)||current;
    if(appSettings?.notifEvents===false || latest.deletedAt || !latest.calendarNotify) return;
    latest.calendarLastNotifiedAt=occurrence;
    latest.updatedAt=Math.max(latest.updatedAt||0,Date.now());
    save();
    fireNotification('📅 '+titleOf(latest),latest.content?stripHtml(latest.content).slice(0,100):'');
    addNotification({type:'calendar',title:'Event starting: '+titleOf(latest),body:new Date(occurrence).toLocaleString(),icon:'alarm-clock'});
    if(latest.calendarRepeat) scheduleEventNotification(latest,occurrence+1);
  },Math.max(0,delay));
  eventNotifTimers.set(current.id,timer);
}
function cancelEventTimers(noteId){
  const timer=eventNotifTimers.get(noteId);
  if(timer) clearTimeout(timer);
  eventNotifTimers.delete(noteId);
}
function rescheduleAllEventNotifications(){
  eventNotifTimers.forEach(timer=>clearTimeout(timer));
  eventNotifTimers.clear();
  if(appSettings?.notifEvents===false) return;
  notes.forEach(note=>{ if(!note.deletedAt && note.calendarNotify) scheduleEventNotification(note); });
}

function createQuickEvent(year, month, day){
  const dateLabel=new Date(year, month, day).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
  const n={
    id:uid(),
    title:`Quick note · ${dateLabel}`,
    content:`<p>Quick planner entry for <strong>${dateLabel}</strong>.</p>`,
    tags:['calendar','planner'],
    pinned:false,
    archived:false,
    createdAt:new Date(year, month, day, 9, 0).getTime(),
    updatedAt:new Date(year, month, day, 9, 0).getTime(),
    fontStyle:'sans'
  };
  notes.unshift(n);
  state.filter='calendar';
  state.currentId=n.id;
  save();
  renderAll();
  showMobileEditor();
}

/* ============================================================
   TASKS & TODOS HUB
   ============================================================ */
function renderTasksView(){
  const listEl=document.getElementById('tasksList');
  if(!listEl) return;

  // Show FAB on mobile, task bar on desktop
  const taskBar=document.getElementById('taskCreateBar');
  const taskFab=document.getElementById('taskFab');
  const isMobile=window.innerWidth<=640;
  const isTasksView=state.filter==='tasks';
  if(taskBar) taskBar.classList.toggle('show', !isMobile && isTasksView);
  if(taskFab) taskFab.classList.toggle('show', isMobile && isTasksView);

  const allTasks=[];
  notes.forEach(n=>{
    if(n.deletedAt||!n.content) return;
    const tmp=document.createElement('div');
    tmp.innerHTML=n.content;
    const checkboxes=tmp.querySelectorAll('input[type=checkbox]');
    checkboxes.forEach((cb, idx)=>{
      const li=cb.closest('li') || cb.parentElement;
      const text=stripHtml(li ? li.innerHTML.replace(/<input[^>]*>/gi, '') : '');
      if(!text) return;
      const isCompleted=cb.checked;
      allTasks.push({
        id:`task_${n.id}_${idx}`,
        noteId:n.id,
        noteTitle:titleOf(n),
        text,
        completed:isCompleted,
        // Inherit the note's creation date so Today/Yesterday filtering works
        createdAt:n.createdAt||Date.now(),
        idx
      });
    });
  });

  // Merge in standalone tasks (created directly in the Tasks Hub)
  const merged=[
    ...standaloneTasks.map(t=>({...t, standalone:true})),
    ...allTasks
  ];

  const now=Date.now();
  const startOfToday=new Date(); startOfToday.setHours(0,0,0,0);
  const todayTs=startOfToday.getTime();

  // Any task without a timestamp is treated as created today so it never disappears.
  const createdOf=t=>(typeof t.createdAt==='number' && !isNaN(t.createdAt)) ? t.createdAt : todayTs;
  const isToday=t=>!t.completed && createdOf(t)>=todayTs;
  const isYesterday=t=>!t.completed && createdOf(t)<todayTs;
  const isDone=t=>!!t.completed;

  // Normalise any legacy/unknown filter value (e.g. the removed "all"/"pending" tabs).
  const validFilters=['today','yesterday','completed'];
  const activeFilter=validFilters.includes(state.taskFilter)?state.taskFilter:'today';
  state.taskFilter=activeFilter;
  const labels={today:'Today',yesterday:'Yesterday',completed:'Completed'};

  document.querySelectorAll('#tasksTabs .mh-tab').forEach(b=>{
    const filter=b.dataset.taskfilter;
    let count=0;
    if(filter==='today') count=merged.filter(isToday).length;
    else if(filter==='yesterday') count=merged.filter(isYesterday).length;
    else if(filter==='completed') count=merged.filter(isDone).length;
    b.innerHTML=`${labels[filter]||filter}${count>0?` (${count})`:''}`;
    b.classList.toggle('active', filter===activeFilter);
  });

  let filtered=merged;
  if(activeFilter==='today') filtered=merged.filter(isToday);
  else if(activeFilter==='yesterday') filtered=merged.filter(isYesterday);
  else if(activeFilter==='completed') filtered=merged.filter(isDone);

  // Sort: overdue first, then by due date, then pending before completed
  filtered.sort((a,b)=>{
    if(a.completed!==b.completed) return a.completed?1:-1;
    if(a.due && b.due) return a.due-b.due;
    if(a.due) return -1;
    if(b.due) return 1;
    return 0;
  });

  const stat=document.getElementById('tasksStatPill');
  if(stat) stat.textContent=`${merged.length} task${merged.length!==1?'s':''}`;

  if(!filtered.length){
    const emptyState={
      today: {
        icon: 'sun',
        title: '🌅 Good morning!',
        subtitle: 'No tasks for today. Enjoy your day, or create one to stay productive.'
      },
      yesterday: {
        icon: 'check-circle',
        title: '✅ All caught up!',
        subtitle: 'No overdue or past tasks left. You are doing great!'
      },
      completed: {
        icon: 'trophy',
        title: '🏆 No completed tasks yet',
        subtitle: 'Start checking things off to see your progress here.'
      }
    };
    const es=emptyState[activeFilter]||{icon:'inbox',title:'No tasks',subtitle:'Create one to get started.'};
    listEl.innerHTML=`<div class="task-empty-state" style="text-align:center;padding:80px 20px;color:var(--fg-secondary)">
      <div style="width:80px;height:80px;margin:0 auto 20px;background:var(--subtle);border-radius:50%;display:flex;align-items:center;justify-content:center">
        <i data-lucide="${es.icon}" style="width:40px;height:40px;opacity:.5"></i>
      </div>
      <div style="font-size:17px;font-weight:700;margin-bottom:10px;color:var(--fg)">${es.title}</div>
      <div style="font-size:13.5px;line-height:1.6;max-width:280px;margin:0 auto">${es.subtitle}</div>
    </div>`;
    refreshIcons();
    return;
  }

  // Group standalone tasks by groupId, render grouped ones as a single card
  const standaloneFiltered=filtered.filter(t=>t.standalone);
  const noteFiltered=filtered.filter(t=>!t.standalone);
  const groups=new Map();
  const ungrouped=[];
  standaloneFiltered.forEach(t=>{
    if(t.groupId){ if(!groups.has(t.groupId)) groups.set(t.groupId,[]); groups.get(t.groupId).push(t); }
    else ungrouped.push(t);
  });

  let html='';

  // Render grouped task blocks
  groups.forEach((tasks, gid)=>{
    const done=tasks.filter(t=>t.completed).length;
    const pct=tasks.length?Math.round((done/tasks.length)*100):0;
    const prio=tasks[0].priority||'medium';
    let dueHtml='';
    if(tasks[0].due){ const d=formatDue(tasks[0].due); dueHtml=`<span class="task-due ${d.cls}"><i data-lucide="${d.overdue?'alarm-clock-off':'alarm-clock'}" class="w-3 h-3"></i>${d.dateStr}</span>`; }
    html+=`<div class="task-hub-card" style="flex-direction:column;align-items:stretch;gap:6px;border-left:3px solid ${pct===100?'var(--success)':'var(--accent)'}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="task-badge ${prio}">${prio}</span>
        <div style="flex:1;height:4px;background:var(--subtle);border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--success);border-radius:99px;transition:width .3s"></div></div>
        ${dueHtml}
      </div>
      ${tasks.map(t=>`<div class="task-row ${t.completed?'completed':''}" style="display:flex;align-items:center;gap:8px;padding:6px 0;transition:all .25s ease;${t.completed?'opacity:.6':''}">
        <input type="checkbox" ${t.completed?'checked':''} onchange="toggleStandaloneTask('${t.id}', this.checked); this.parentElement.classList.toggle('completed', this.checked); this.parentElement.style.opacity=this.checked?.5:1" style="margin:0">
        <span style="font-size:13.5px;${t.completed?'text-decoration:line-through;color:var(--fg-muted)':'color:var(--fg)'};transition:all .25s ease">${esc(t.text)}</span>
        <button class="task-del-btn" onclick="deleteStandaloneTask('${t.id}')" title="Delete" style="margin-left:auto;opacity:.6"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>`).join('')}
    </div>`;
  });

  // Render ungrouped standalone tasks
  ungrouped.forEach(t=>{
    let dueHtml='';
    if(t.due){ const d=formatDue(t.due); dueHtml=`<span class="task-due ${d.cls}"><i data-lucide="${d.overdue?'alarm-clock-off':'alarm-clock'}" class="w-3 h-3"></i>${d.dateStr}</span>`; }
    html+=`<div class="task-hub-card task-row ${t.completed?'completed':''}" style="border-left:2px solid ${t.completed?'var(--success)':'var(--border-muted)'};transition:all .25s ease;opacity:${t.completed?.6:1}">
      <input type="checkbox" ${t.completed?'checked':''} onchange="toggleStandaloneTask('${t.id}', this.checked); this.closest('.task-hub-card').classList.toggle('completed', this.checked); this.closest('.task-hub-card').style.opacity=this.checked?.6:1">
      <div class="task-hub-content">
        <div class="task-hub-title ${t.completed?'completed':''}" style="transition:all .25s ease">${esc(t.text)}</div>
        <div class="task-meta-row">
          <span class="task-badge ${t.priority||'medium'}">${t.priority||'medium'}</span>
          ${dueHtml}
        </div>
      </div>
      <button class="task-del-btn" onclick="deleteStandaloneTask('${t.id}')" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
    </div>`;
  });

  // Render note-embedded tasks
  noteFiltered.forEach(t=>{
    html+=`<div class="task-hub-card task-row ${t.completed?'completed':''}" style="border-left:2px solid ${t.completed?'var(--success)':'var(--border-muted)'};transition:all .25s ease;opacity:${t.completed?.6:1}">
      <input type="checkbox" ${t.completed?'checked':''} onchange="toggleTaskHubItem('${t.noteId}', ${t.idx}, this.checked); this.closest('.task-hub-card').classList.toggle('completed', this.checked); this.closest('.task-hub-card').style.opacity=this.checked?.6:1">
      <div class="task-hub-content">
        <div class="task-hub-title ${t.completed?'completed':''}" style="transition:all .25s ease">${esc(t.text)}</div>
        <div class="task-meta-row">
          <div class="task-hub-note-link" onclick="jumpToNote('${t.noteId}')" title="Open Note">
            <i data-lucide="file-text" class="w-3 h-3"></i>
            <span>${esc(t.noteTitle)}</span>
          </div>
        </div>
      </div>
      <button class="task-del-btn" onclick="deleteNoteTask('${t.noteId}', ${t.idx})" title="Delete task"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
    </div>`;
  });

  listEl.innerHTML=html;
  updateNotifBar();
  refreshIcons();
}

function toggleTaskHubItem(noteId, idx, checked){
  const n=getNote(noteId);
  if(!n || !n.content) return;
  const tmp=document.createElement('div');
  tmp.innerHTML=n.content;
  const checkboxes=tmp.querySelectorAll('input[type=checkbox]');
  if(checkboxes[idx]){
    if(checked){ checkboxes[idx].setAttribute('checked','checked'); playTaskCompleteSound(); }
    else checkboxes[idx].removeAttribute('checked');
    checkboxes[idx].checked=checked;
    n.content=tmp.innerHTML;
    n.updatedAt=Date.now();
    save();
    renderTasksView();
    updateTasksCount();
    toast(checked?'Task completed':'Task marked pending');
  }
}

window.resolveProductivitySource = function(type, sourceId) {
  if (type === 'calendar') {
    const canonicalNotes = typeof window.getCanonicalNotes === 'function' ? window.getCanonicalNotes() : (typeof notes !== 'undefined' ? notes : []);
    const ev = canonicalNotes.find(n => String(n.id) === String(sourceId));
    return (ev && !ev.deleted && !ev.deletedAt) ? ev : null;
  } else if (type === 'todo-list') {
    const canonicalTasks = typeof window.getCanonicalStandaloneTasks === 'function' ? window.getCanonicalStandaloneTasks() : (typeof standaloneTasks !== 'undefined' ? standaloneTasks : []);
    return canonicalTasks.filter(t => String(t.groupId) === String(sourceId) && !t.deleted && !t.deletedAt);
  }
  return null;
};

window.buildProductivityStaticSnapshot = function(type, source) {
  const escStr = (s) => (s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (!source || (Array.isArray(source) && source.length === 0)) {
    return `<div class="productivity-ref-missing">
      <div class="ref-missing-title">⚠️ ${type==='calendar'?'Calendar event':'Todo list'} unavailable</div>
      <div class="ref-missing-desc">The original item may have been deleted.</div>
    </div>`;
  }
  
  const normalizeProductivityDate = (val) => {
    if (!val) return new Date(NaN);
    if (typeof val === 'object') {
      if (typeof val.toDate === 'function') return val.toDate();
      if (typeof val.toMillis === 'function') return new Date(val.toMillis());
      if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    }
    return new Date(val);
  };

  if (type === 'calendar') {
    const title = source.title || 'Untitled Event';
    const dStart = normalizeProductivityDate(source.calendarStart);
    const startFmt = isNaN(dStart) ? 'Date unavailable' : dStart.toLocaleString(undefined, {weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const dEnd = normalizeProductivityDate(source.calendarEnd);
    const endFmt = isNaN(dEnd) ? '' : dEnd.toLocaleString(undefined, {weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const repeatStr = source.calendarRepeat && source.calendarRepeat !== 'none' ? ` 🔁 ${escStr(source.calendarRepeat)}` : '';
    const notifyStr = source.calendarNotify ? ` 🔔` : '';
    const rawDesc = source.content ? source.content.replace(/<[^>]*>?/gm, '') : '';
    const descStr = rawDesc ? `<br><small style="color:var(--fg-muted)">${escStr(rawDesc.substring(0,60))}${rawDesc.length>60?'...':''}</small>` : '';
    return `<div>📅 Event: <strong>${escStr(title)}</strong></div><div>${escStr(startFmt)} → ${escStr(endFmt)}${repeatStr}${notifyStr}</div>${descStr}`;
  } else if (type === 'todo-list') {
    const title = source[0].groupTitle || 'Todo List';
    const total = source.length;
    const completed = source.filter(t => t.completed).length;
    const itemsHtml = source.slice(0, 3).map(t => `<div>${t.completed?'☑':'☐'} ${escStr(t.text)}</div>`).join('');
    const moreHtml = total > 3 ? `<div style="color:var(--fg-muted)">+ ${total-3} more</div>` : '';
    return `<div>✅ Todo List: <strong>${escStr(title)}</strong> (${completed}/${total} completed)</div>${itemsHtml}${moreHtml}`;
  }
  return '';
};

window.dehydrateProductivityReference = function(ref) {
  if (!ref) return;
  ref.removeAttribute('data-hydrated');
  const transientUI = ref.querySelectorAll('[data-paperuss-ui="true"]');
  transientUI.forEach(el => el.remove());
  const staticCard = ref.querySelector('.productivity-ref-static');
  if (staticCard) {
    staticCard.style.display = '';
  }
};

window.dehydrateProductivityReferences = function(rootElement) {
  if (!rootElement) return;
  if (rootElement.matches && rootElement.matches('.productivity-ref')) {
    window.dehydrateProductivityReference(rootElement);
  }
  const refs = rootElement.querySelectorAll('.productivity-ref');
  refs.forEach(ref => window.dehydrateProductivityReference(ref));
};

window.hydrateProductivityReferences = function(rootElement) {
  if (!rootElement) return;
  const refs = [];
  if (rootElement.matches && rootElement.matches('.productivity-ref')) refs.push(rootElement);
  rootElement.querySelectorAll('.productivity-ref').forEach(r => refs.push(r));
  
  refs.forEach(ref => {
    window.dehydrateProductivityReference(ref); // Make hydration idempotent
    ref.setAttribute('data-hydrated', 'true');
    const type = ref.getAttribute('data-paperuss-productivity');
    const sourceId = ref.getAttribute('data-source-id');
    const source = window.resolveProductivitySource(type, sourceId);
    
    let staticCard = ref.querySelector('.productivity-ref-static');
    if (!staticCard) {
      staticCard = document.createElement('div');
      staticCard.className = 'productivity-ref-static';
      ref.appendChild(staticCard);
    }
    staticCard.innerHTML = window.buildProductivityStaticSnapshot(type, source);
    staticCard.style.display = 'none';

    const hydrateContainer = document.createElement('div');
    hydrateContainer.setAttribute('data-paperuss-ui', 'true');
    hydrateContainer.className = 'productivity-ref-hydrated';
    

    
    const actionArea = document.createElement('div');
    actionArea.setAttribute('data-paperuss-ui', 'true');
    actionArea.className = 'productivity-ref-actions';
    
    let isMissing = !source || (Array.isArray(source) && source.length === 0);
    
    if (isMissing) {
      actionArea.innerHTML = `<button type="button" class="productivity-ref-remove btn btn-sm">Remove from Leaf</button>`;
      const btnRem = actionArea.querySelector('.productivity-ref-remove');
      btnRem.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.removeProductivityReference === 'function') window.removeProductivityReference(ref);
      };
    } else {
      actionArea.innerHTML = `
        <button type="button" class="productivity-ref-open btn btn-sm">Open</button>
        <button type="button" class="productivity-ref-more btn btn-sm">•••</button>
      `;
      const btnOpen = actionArea.querySelector('.productivity-ref-open');
      const handleOpen = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === 'calendar') {
          if (typeof window.openCalendarEventEditor === 'function') window.openCalendarEventEditor(sourceId);
        } else if (type === 'todo-list') {
          if (typeof window.openTodoListEditor === 'function') window.openTodoListEditor(sourceId);
        }
      };
      btnOpen.onclick = handleOpen;
      hydrateContainer.onclick = handleOpen;
      hydrateContainer.style.cursor = 'pointer';
      
      const btnMore = actionArea.querySelector('.productivity-ref-more');
      btnMore.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        let existingMenu = actionArea.querySelector('.productivity-ref-menu');
        if (existingMenu) {
          existingMenu.remove();
          return;
        }
        
        const menu = document.createElement('div');
        menu.className = 'productivity-ref-menu';
        menu.setAttribute('data-paperuss-ui', 'true');
        menu.style.position = 'absolute';
        menu.style.right = '0';
        menu.style.top = '100%';
        menu.style.background = 'var(--bg)';
        menu.style.border = '1px solid var(--border)';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        menu.style.zIndex = '1000';
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.padding = '4px';
        menu.style.minWidth = '160px';
        
        const typeLabel = type === 'calendar' ? 'Event' : 'Todo List';
        
        menu.innerHTML = `
          <button type="button" class="btn btn-menu btn-edit" style="text-align:left;padding:6px;border:none;background:transparent;width:100%">Edit ${typeLabel}</button>
          <button type="button" class="btn btn-menu btn-rem" style="text-align:left;padding:6px;border:none;background:transparent;width:100%">Remove from Leaf</button>
          <button type="button" class="btn btn-menu btn-del" style="text-align:left;padding:6px;border:none;background:transparent;width:100%;color:var(--danger)">Delete Source ${typeLabel}</button>
        `;
        
        menu.querySelector('.btn-edit').onclick = handleOpen;
        menu.querySelector('.btn-rem').onclick = (e2) => {
          e2.preventDefault();
          e2.stopPropagation();
          if (typeof window.removeProductivityReference === 'function') window.removeProductivityReference(ref);
        };
        menu.querySelector('.btn-del').onclick = (e2) => {
          e2.preventDefault();
          e2.stopPropagation();
          menu.remove();
          if (type === 'calendar') {
            if (typeof window.deleteCalendarSource === 'function') window.deleteCalendarSource(sourceId);
          } else if (type === 'todo-list') {
            if (typeof window.deleteTodoListSource === 'function') window.deleteTodoListSource(sourceId);
          }
        };
        
        actionArea.appendChild(menu);
        
        const clickAway = (ce) => {
          if (!menu.contains(ce.target) && ce.target !== btnMore) {
            menu.remove();
            document.removeEventListener('click', clickAway);
          }
        };
        document.addEventListener('click', clickAway);
        
        // Ensure manual removal also cleans up listener
        const originalRemove = menu.remove;
        menu.remove = function() {
          document.removeEventListener('click', clickAway);
          originalRemove.apply(this, arguments);
        };
      };
    }
    
    hydrateContainer.style.position = 'relative';
    hydrateContainer.appendChild(actionArea);

    const escStr = (s) => (s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = window.buildProductivityStaticSnapshot(type, source);
    hydrateContainer.insertBefore(contentDiv, actionArea);
    ref.appendChild(hydrateContainer);
  });
};

window.insertProductivityReference = function(type, sourceId) {
  if (type !== 'calendar' && type !== 'todo-list') {
    if(typeof toast === 'function') toast('Invalid reference type');
    return;
  }
  
  const normSourceId = String(sourceId);
  const safeId = typeof sanitizeId === 'function' ? sanitizeId(normSourceId) : normSourceId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) {
    if(typeof toast === 'function') toast('Invalid source ID');
    return;
  }

  const source = window.resolveProductivitySource(type, safeId);
  if (!source || (Array.isArray(source) && source.length === 0)) {
    if(typeof toast === 'function') toast('Source not found in canonical store');
    return;
  }
  
  const staticHtml = window.buildProductivityStaticSnapshot(type, source);
  const html = `<div class="productivity-ref productivity-ref-${type}" data-paperuss-productivity="${type}" data-source-id="${safeId}" data-ref-version="1" contenteditable="false"><div class="productivity-ref-static">${staticHtml}</div></div><p><br></p>`;
  
  const ed = document.getElementById('noteBody');
  if(ed) {
    ed.focus();
    document.execCommand('insertHTML', false, html);
    if(typeof handleBodyInput === 'function') handleBodyInput();
    window.hydrateProductivityReferences(ed);
  }
};


window.refreshProductivityReferences = function(type, sourceId) {
  const normType = String(type);
  const normId = String(sourceId);
  const allRefs = document.querySelectorAll('.productivity-ref');
  const refs = Array.from(allRefs).filter(r => r.getAttribute('data-paperuss-productivity') === normType && String(r.getAttribute('data-source-id')) === normId);
  if (refs.length === 0) return;
  
  const source = window.resolveProductivitySource(normType, normId);
  const staticHtml = window.buildProductivityStaticSnapshot(normType, source);
  
  let changed = false;
  
  refs.forEach(ref => {
    window.dehydrateProductivityReference(ref);
    let staticCard = ref.querySelector('.productivity-ref-static');
    if (!staticCard) {
      staticCard = document.createElement('div');
      staticCard.className = 'productivity-ref-static';
      ref.appendChild(staticCard);
    }
    if (staticCard.innerHTML !== staticHtml) {
      staticCard.innerHTML = staticHtml;
      changed = true;
    }
    window.hydrateProductivityReferences(ref);
  });
  
  if (changed) {
    if (typeof handleBodyInput === 'function') {
      handleBodyInput();
    } else if (typeof onEditorInput === 'function') {
      onEditorInput();
    }
  }
};

window.openCalendarEventEditor = function(eventId) {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  
  const canonicalNotes = typeof window.getCanonicalNotes === 'function' ? window.getCanonicalNotes() : (typeof notes !== 'undefined' ? notes : []);
  const evNote = canonicalNotes.find(n => String(n.id) === String(eventId));
  
  if (!evNote || evNote.deletedAt || !(evNote.tags||[]).includes('calendar')) {
    if(typeof toast === 'function') toast('Calendar event unavailable.');
    return;
  }
  
  const esc = (s) => (s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let rawDesc = '';
  if (evNote.calendarDescription !== undefined) {
    rawDesc = evNote.calendarDescription;
  } else if (evNote.content) {
    rawDesc = evNote.content.replace(/<[^>]*>?/gm, '');
    const toStrip = ['📅', '→', '🔁 Repeats:'];
    let lines = rawDesc.split('\n');
    lines = lines.filter(l => !toStrip.some(p => l.includes(p))).map(l => l.trim()).filter(l => l);
    rawDesc = lines.join('\n');
  }
  
  let startTs = evNote.calendarStart;
  let endTs = evNote.calendarEnd;
  const normalizeProductivityDate = window.normalizeProductivityDate || ((val) => {
    if (!val) return new Date(NaN);
    if (typeof val === 'object') {
      if (typeof val.toDate === 'function') return val.toDate();
      if (typeof val.toMillis === 'function') return new Date(val.toMillis());
      if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    }
    return new Date(val);
  });
  
  const dStart = normalizeProductivityDate(startTs);
  const dEnd = normalizeProductivityDate(endTs);
  
  if (isNaN(dStart) || isNaN(dEnd)) {
    if(typeof toast === 'function') toast('Calendar event date unavailable.');
    return;
  }
  
  const yS = dStart.getFullYear();
  const mS = String(dStart.getMonth()+1).padStart(2, '0');
  const dS = String(dStart.getDate()).padStart(2, '0');
  const hs = String(dStart.getHours()).padStart(2, '0');
  const ms = String(dStart.getMinutes()).padStart(2, '0');
  
  const yE = dEnd.getFullYear();
  const mE = String(dEnd.getMonth()+1).padStart(2, '0');
  const dE = String(dEnd.getDate()).padStart(2, '0');
  const he = String(dEnd.getHours()).padStart(2, '0');
  const me = String(dEnd.getMinutes()).padStart(2, '0');
  
  let eventType = 'event';
  if ((evNote.tags||[]).includes('meeting')) eventType = 'meeting';
  if ((evNote.tags||[]).includes('deadline')) eventType = 'deadline';
  if ((evNote.tags||[]).includes('planner')) eventType = 'planner';

  let isSaving = false;

  root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:500px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0">✏️ Edit Calendar Event</h3>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
      <input id="evEditTitle" placeholder="Event title" value="${esc(evNote.title)}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;outline:none;color:var(--fg)">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="evEditStartDate" type="date" value="${yS}-${mS}-${dS}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px" title="Start date">
        <input id="evEditStartTime" type="time" value="${hs}:${ms}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px" title="Start time">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="evEditEndDate" type="date" value="${yE}-${mE}-${dE}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px" title="End date">
        <input id="evEditEndTime" type="time" value="${he}:${me}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px" title="End time">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="evEditType" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:110px">
          <option value="event" ${eventType==='event'?'selected':''}>🗓️ General Event</option>
          <option value="meeting" ${eventType==='meeting'?'selected':''}>👥 Meeting</option>
          <option value="deadline" ${eventType==='deadline'?'selected':''}>⏰ Deadline</option>
          <option value="planner" ${eventType==='planner'?'selected':''}>📝 Planner Note</option>
        </select>
        <select id="evEditRepeat" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:120px">
          <option value="none" ${!evNote.calendarRepeat||evNote.calendarRepeat==='none'?'selected':''}>🔁 Does not repeat</option>
          <option value="daily" ${evNote.calendarRepeat==='daily'?'selected':''}>🔄 Every day</option>
          <option value="weekly" ${evNote.calendarRepeat==='weekly'?'selected':''}>📅 Every week</option>
          <option value="monthly" ${evNote.calendarRepeat==='monthly'?'selected':''}>📆 Every month</option>
          <option value="yearly" ${evNote.calendarRepeat==='yearly'?'selected':''}>🗓️ Every year</option>
        </select>
      </div>
      <textarea id="evEditDesc" placeholder="Optional description…" rows="2" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px;outline:none;color:var(--fg);resize:vertical">${esc(rawDesc)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg-secondary);cursor:pointer">
        <input type="checkbox" id="evEditNotify" ${evNote.calendarNotify?'checked':''}> Notify me when this event starts
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="evEditCancel">Cancel</button>
      <button class="btn btn-primary" id="evEditSave">Save Changes</button>
    </div>
  </div></div>`;
  
  const close = () => { root.innerHTML = ''; };
  document.getElementById('evEditCancel').onclick = close;
  const overlay = root.querySelector('.modal-overlay');
  if (overlay) overlay.onclick = (e) => { if (e.target === overlay) close(); };
  
  document.getElementById('evEditSave').onclick = () => {
    if (isSaving) return;
    
    const freshNotes = typeof window.getCanonicalNotes === 'function' ? window.getCanonicalNotes() : (typeof notes !== 'undefined' ? notes : []);
    const freshEv = freshNotes.find(n => String(n.id) === String(eventId));
    if (!freshEv) {
      if(typeof toast === 'function') toast('Event no longer exists.');
      close();
      return;
    }
    
    const title = document.getElementById('evEditTitle').value.trim() || 'Untitled Event';
    const sD = document.getElementById('evEditStartDate').value;
    const sT = document.getElementById('evEditStartTime').value || '09:00';
    const eD = document.getElementById('evEditEndDate').value || sD;
    const eT = document.getElementById('evEditEndTime').value || '10:00';
    
    const newStartTs = new Date(sD + 'T' + sT + ':00').getTime();
    const newEndTs = new Date(eD + 'T' + eT + ':00').getTime();
    
    if(!Number.isFinite(newStartTs) || !Number.isFinite(newEndTs)) {
      if(typeof toast === 'function') toast('Enter valid event dates and times');
      return;
    }
    if (newEndTs < newStartTs) {
      if(typeof toast === 'function') toast('Event end must be after its start');
      return;
    }
    
    isSaving = true;
    const type = document.getElementById('evEditType').value;
    const repeatVal = document.getElementById('evEditRepeat').value;
    const notify = document.getElementById('evEditNotify').checked;
    const desc = document.getElementById('evEditDesc').value.trim();
    
    let tags = (freshEv.tags || []).filter(t => t !== 'meeting' && t !== 'deadline' && t !== 'planner' && t !== 'recurring' && !t.startsWith('repeat-'));
    if (!tags.includes('calendar')) tags.push('calendar');
    if (type === 'meeting') tags.push('meeting');
    if (type === 'deadline') tags.push('deadline');
    if (type === 'planner') tags.push('planner');
    if (repeatVal !== 'none') { tags.push('recurring'); tags.push('repeat-'+repeatVal); }
    
    const startFmt = new Date(newStartTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const endFmt = new Date(newEndTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const content_html = (typeof sanitizeNoteHTML === 'function') ? sanitizeNoteHTML(`<p><strong>📅 ${esc(startFmt)}</strong></p><p>→ ${esc(endFmt)}</p>${repeatVal!=='none'?`<p>🔁 Repeats: ${esc(repeatVal)}</p>`:''}${desc?`<p>${esc(desc)}</p>`:''}`) : `<p><strong>📅 ${esc(startFmt)}</strong></p><p>→ ${esc(endFmt)}</p>${repeatVal!=='none'?`<p>🔁 Repeats: ${esc(repeatVal)}</p>`:''}${desc?`<p>${esc(desc)}</p>`:''}`;

    document.getElementById('evEditSave').disabled = true;
    const backupEv = { ...freshEv };
    
    freshEv.title = title;
    freshEv.content = content_html;
    freshEv.tags = tags;
    freshEv.calendarStart = newStartTs;
    freshEv.calendarEnd = newEndTs;
    freshEv.calendarRepeat = repeatVal === 'none' ? null : repeatVal;
    freshEv.calendarNotify = notify;
    freshEv.calendarDescription = desc;
    freshEv.updatedAt = Date.now();
    
    Promise.resolve().then(() => typeof save === 'function' ? save() : null).then(() => {
      if (typeof renderCalendarView === 'function') renderCalendarView();
      if (typeof renderAll === 'function') renderAll();
      
      window.refreshProductivityReferences('calendar', eventId);
      if(typeof toast === 'function') toast('Event updated successfully');
      
      close();
    }).catch(e => {
      if(typeof toast === 'function') toast('Failed to save event');
      isSaving = false;
      Object.assign(freshEv, backupEv);
      const btn = document.getElementById('evEditSave');
      if (btn) btn.disabled = false;
    });
  };
};

window.openTodoListEditor = function(groupId) {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  
  const canonicalTasks = typeof window.getCanonicalStandaloneTasks === 'function' ? window.getCanonicalStandaloneTasks() : (typeof standaloneTasks !== 'undefined' ? standaloneTasks : []);
  const groupTasks = canonicalTasks.filter(t => String(t.groupId) === String(groupId) && !t.deleted && !t.deletedAt);
  
  if (groupTasks.length === 0) {
    if(typeof toast === 'function') toast('Todo list unavailable.');
    return;
  }
  
  const esc = (s) => (s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let draftTitle = groupTasks[0].groupTitle || 'Todo List';
  
  let draftTasks = groupTasks.map(t => ({ ...t }));
  let isSaving = false;

  const renderDraft = () => {
    let rowsHtml = '';
    draftTasks.forEach((t, idx) => {
      let dueVal = '';
      if (t.due) {
        const dd = new Date(t.due);
        if (!isNaN(dd)) {
          const dy = dd.getFullYear();
          const dm = String(dd.getMonth()+1).padStart(2,'0');
          const ddt = String(dd.getDate()).padStart(2,'0');
          const dh = String(dd.getHours()).padStart(2,'0');
          const dmin = String(dd.getMinutes()).padStart(2,'0');
          dueVal = `${dy}-${dm}-${ddt}T${dh}:${dmin}`;
        }
      }
      rowsHtml += `
        <div style="display:flex;gap:8px;align-items:center;padding:6px;background:var(--subtle);border-radius:6px;margin-bottom:6px">
          <input type="checkbox" data-idx="${idx}" class="draft-task-done" ${t.completed?'checked':''}>
          <input type="text" data-idx="${idx}" class="draft-task-text" value="${esc(t.text)}" style="flex:1;background:transparent;border:none;outline:none;font-size:14px;color:var(--fg)">
          <select data-idx="${idx}" class="draft-task-pri" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:12px;padding:2px">
            <option value="none" ${t.priority==='none'||!t.priority?'selected':''}>-</option>
            <option value="low" ${t.priority==='low'?'selected':''}>Low</option>
            <option value="medium" ${t.priority==='medium'?'selected':''}>Medium</option>
            <option value="high" ${t.priority==='high'?'selected':''}>High</option>
          </select>
          <input type="datetime-local" data-idx="${idx}" class="draft-task-due" value="${dueVal}" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:12px;padding:2px">
          <button type="button" data-idx="${idx}" class="draft-task-del btn" style="padding:4px;color:var(--danger)"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      `;
    });
    
    root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:500px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0">✏️ Edit Todo List</h3>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <input id="todoEditTitle" placeholder="List title" value="${esc(draftTitle)}" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;outline:none;color:var(--fg);font-weight:bold">
        <div style="max-height:400px;overflow-y:auto;padding-right:4px">
          ${rowsHtml}
        </div>
        <button type="button" class="btn" id="todoEditAddRow"><i data-lucide="plus" class="w-4 h-4"></i> Add Task</button>
      </div>
      <div class="modal-actions">
        <button class="btn" id="todoEditCancel">Cancel</button>
        <button class="btn btn-primary" id="todoEditSave">Save Changes</button>
      </div>
    </div></div>`;
    
    if (typeof refreshIcons === 'function') refreshIcons();
    
    document.getElementById('todoEditCancel').onclick = close;
    const overlay = root.querySelector('.modal-overlay');
    if (overlay) overlay.onclick = (e) => { if (e.target === overlay) close(); };
    
    document.getElementById('todoEditTitle').oninput = (e) => { draftTitle = e.target.value; };
    
    document.getElementById('todoEditAddRow').onclick = () => {
      draftTasks.push({ id: (typeof uid === 'function' ? uid() : Date.now().toString()), text: '', completed: false, priority: 'none', groupId: groupId });
      renderDraft();
    };
    
    root.querySelectorAll('.draft-task-text').forEach(el => el.oninput = (e) => { draftTasks[e.target.dataset.idx].text = e.target.value; });
    root.querySelectorAll('.draft-task-done').forEach(el => el.onchange = (e) => { draftTasks[e.target.dataset.idx].completed = e.target.checked; });
    root.querySelectorAll('.draft-task-pri').forEach(el => el.onchange = (e) => { draftTasks[e.target.dataset.idx].priority = e.target.value; });
    root.querySelectorAll('.draft-task-due').forEach(el => el.onchange = (e) => { draftTasks[e.target.dataset.idx].due = e.target.value ? new Date(e.target.value).getTime() : null; });
    root.querySelectorAll('.draft-task-del').forEach(el => el.onclick = (e) => {
      draftTasks.splice(e.currentTarget.dataset.idx, 1);
      renderDraft();
    });
    
    document.getElementById('todoEditSave').onclick = () => {
      if (isSaving) return;
      draftTasks = draftTasks.filter(t => t.text.trim());
      if (draftTasks.length === 0) {
        if(typeof toast === 'function') toast('List must have at least one valid task.');
        return;
      }
      isSaving = true;
      
      const freshTasks = typeof window.getCanonicalStandaloneTasks === 'function' ? window.getCanonicalStandaloneTasks() : (typeof standaloneTasks !== 'undefined' ? standaloneTasks : []);
      const newTitle = draftTitle.trim() || 'Todo List';
      
      const backupTasks = freshTasks.map(t => ({...t}));
      const existingIds = new Set(groupTasks.map(t => String(t.id)));
      const newIds = new Set(draftTasks.map(t => String(t.id)));
      
      existingIds.forEach(id => {
        if (!newIds.has(id)) {
          const t = freshTasks.find(x => String(x.id) === id);
          if (t) { t.deleted = true; t.deletedAt = Date.now(); }
        }
      });
      
      draftTasks.forEach(dt => {
        dt.groupTitle = newTitle;
        dt.groupId = groupId;
        const t = freshTasks.find(x => String(x.id) === String(dt.id));
        if (t) {
          let changed = false;
          if (t.text !== dt.text) { t.text = dt.text; changed = true; }
          if (t.completed !== dt.completed) { t.completed = dt.completed; changed = true; }
          if (t.priority !== dt.priority) { t.priority = dt.priority; changed = true; }
          if (t.due !== dt.due) { t.due = dt.due; changed = true; }
          if (t.groupTitle !== dt.groupTitle) { t.groupTitle = dt.groupTitle; changed = true; }
          if (changed) t.updatedAt = Date.now();
        } else {
          dt.createdAt = Date.now();
          dt.updatedAt = Date.now();
          freshTasks.push(dt);
        }
      });
      
      document.getElementById('todoEditSave').disabled = true;
      
      Promise.resolve().then(() => typeof saveTasks === 'function' ? saveTasks() : null).then(() => {
        if (typeof renderTasksView === 'function') renderTasksView();
        if (typeof updateTasksCount === 'function') updateTasksCount();
        
        window.refreshProductivityReferences('todo-list', groupId);
        if(typeof toast === 'function') toast('Todo list updated successfully');
        
        close();
      }).catch(e => {
        if(typeof toast === 'function') toast('Failed to save todo list');
        
        // Restore from backup in place
        freshTasks.splice(0, freshTasks.length, ...backupTasks.map(task => ({ ...task })));
        
        isSaving = false;
        const btn = document.getElementById('todoEditSave');
        if (btn) btn.disabled = false;
      });
    };
  };

  const close = () => { root.innerHTML = ''; };
  renderDraft();
};

window.removeProductivityReference = function(ref) {
  if (ref && ref.parentNode) {
    ref.remove();
    if (typeof handleBodyInput === 'function') handleBodyInput();
    if (typeof toast === 'function') toast('Reference removed from note');
  }
};

window.deleteCalendarSource = function(eventId) {
  if (!confirm('Are you sure you want to delete this event source?')) return;
  const canonicalNotes = typeof window.getCanonicalNotes === 'function' ? window.getCanonicalNotes() : (typeof notes !== 'undefined' ? notes : []);
  const ev = canonicalNotes.find(n => String(n.id) === String(eventId));
  if (!ev) {
    if (typeof toast === 'function') toast('Event already deleted or missing');
    return;
  }
  const backup = { ...ev };
  ev.deleted = true;
  ev.deletedAt = Date.now();
  
  Promise.resolve().then(() => typeof save === 'function' ? save() : null).then(() => {
    if (typeof renderCalendarView === 'function') renderCalendarView();
    if (typeof renderAll === 'function') renderAll();
    window.refreshProductivityReferences('calendar', eventId);
    if (typeof toast === 'function') toast('Calendar event source deleted');
  }).catch(e => {
    Object.assign(ev, backup);
    if (!('deleted' in backup)) delete ev.deleted;
    if (!('deletedAt' in backup)) delete ev.deletedAt;
    if (typeof toast === 'function') toast('Failed to delete event source');
  });
};

window.deleteTodoListSource = function(groupId) {
  if (!confirm('Are you sure you want to delete this todo list source?')) return;
  const canonicalTasks = typeof window.getCanonicalStandaloneTasks === 'function' ? window.getCanonicalStandaloneTasks() : (typeof standaloneTasks !== 'undefined' ? standaloneTasks : []);
  
  const backupTasks = canonicalTasks.map(t => ({...t}));
  let changed = false;
  
  canonicalTasks.forEach(t => {
    if (String(t.groupId) === String(groupId) && !t.deleted && !t.deletedAt) {
      t.deleted = true;
      t.deletedAt = Date.now();
      changed = true;
    }
  });
  
  if (!changed) {
    if (typeof toast === 'function') toast('Todo list already deleted or missing');
    return;
  }
  
  Promise.resolve().then(() => typeof saveTasks === 'function' ? saveTasks() : null).then(() => {
    if (typeof renderTasksView === 'function') renderTasksView();
    if (typeof updateTasksCount === 'function') updateTasksCount();
    window.refreshProductivityReferences('todo-list', groupId);
    if (typeof toast === 'function') toast('Todo list source deleted');
  }).catch(e => {
    canonicalTasks.splice(0, canonicalTasks.length, ...backupTasks.map(task => ({ ...task })));
    if (typeof toast === 'function') toast('Failed to delete todo list source');
  });
};
