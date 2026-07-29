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
  if(!html)html=`<div class="list-empty"><i data-lucide="calendar-check" style="width:30px;height:30px;margin:0 auto 10px;opacity:.45"></i>No items for this date.<br>Double-click the date to create an event.</div>`;
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

function openCalendarEventCreator(year, month, day){
  const dateLabel=new Date(year, month, day).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:460px">
    <h3>📅 New Event / Planner Note</h3>
    <p style="font-size:13px;color:var(--fg-secondary);margin-bottom:14px">${dateLabel}</p>
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
    </div>
    <div class="modal-actions">
      <button class="btn" id="evCancel">Cancel</button>
      <button class="btn btn-primary" id="evCreate">Create Event</button>
    </div>
  </div></div>`;

  const close=()=>root.innerHTML='';
  document.getElementById('evCancel').onclick=close;
  document.getElementById('evCreate').onclick=()=>{
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
    const [sh,sm]=startTimeStr.split(':').map(Number);
    const startDateVal=startDateEl.value||`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const startTs=new Date(startDateVal+'T'+startTimeStr+':00').getTime();
    const endDateVal=endDateEl.value||startDateVal;
    const endTimeStr=endTimeEl.value||'10:00';
    const [eh,em]=endTimeStr.split(':').map(Number);
    const endTs=new Date(endDateVal+'T'+endTimeStr+':00').getTime();
    const type=typeEl.value;
    const repeatVal=repeatEl.value;
    const notify=notifyEl.checked;
    let tags=['calendar'];
    if(type==='meeting') tags.push('meeting');
    if(type==='deadline') tags.push('deadline');
    if(type==='planner') tags.push('planner');
    if(repeatVal!=='none'){ tags.push('recurring'); tags.push('repeat-'+repeatVal); }
    const startFmt=new Date(startTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const endFmt=new Date(endTs).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const content=`<p><strong>📅 ${startFmt}</strong></p><p>→ ${endFmt}</p>${repeatVal!=='none'?`<p>🔁 Repeats: ${repeatVal}</p>`:''}${descEl.value?`<p>${descEl.value}</p>`:''}`;
    const n={
      id:uid(), title, content, tags, pinned:type==='deadline',
      archived:false,
      createdAt:startTs, updatedAt:startTs,
      calendarStart:startTs,
      calendarEnd:endTs,
      calendarRepeat:repeatVal!=='none'?repeatVal:null,
      calendarNotify:notify,
      fontStyle:'sans'
    };
    notes.unshift(n);
    // If user wrote a description, also create a linked "Notes" block for this event
    if(descEl.value && descEl.value.trim()){
      const linkedNote={
        id:uid(), title:title+' · Notes', content:`<p><strong>${startFmt} → ${endFmt}</strong></p><p>${descEl.value}</p>`,
        tags:['calendar','planner'],
        pinned:false, archived:false,
        createdAt:startTs, updatedAt:startTs,
        calendarStart:startTs, calendarEnd:endTs,
        calendarRepeat:null, calendarNotify:false,
        fontStyle:'sans'
      };
      notes.unshift(linkedNote);
    }
    state.filter='calendar';
    state.currentId=n.id;
    save();
    renderAll();
    if(notify){ scheduleEventNotification(n); }
    addNotification({type:'note',title:'Event created',body:`"${title}" — ${startFmt}${repeatVal!=='none'?` (repeats ${repeatVal})`:''}`,icon:'calendar'});
    close();
  };
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
  setTimeout(()=>document.getElementById('evTitle').focus(),50);
}

let eventNotifTimers=[];
function scheduleEventNotification(note){
  if(!note.calendarStart || !note.calendarNotify) return;
  const msUntil=note.calendarStart - Date.now();
  if(msUntil<=0) return;
  // Store timer so we can cancel on note delete
  const timer=setTimeout(()=>{
    fireNotification('📅 '+titleOf(note), note.content?stripHtml(note.content).slice(0,100):'');
    addNotification({type:'task',title:'Event starting: '+titleOf(note),body:new Date(note.calendarStart).toLocaleString(),icon:'alarm-clock'});
  }, msUntil);
  eventNotifTimers.push({id:note.id, timer});
}
function cancelEventTimers(noteId){
  const found=eventNotifTimers.find(t=>t.id===noteId);
  if(found){ clearTimeout(found.timer); eventNotifTimers=eventNotifTimers.filter(t=>t.id!==noteId); }
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
