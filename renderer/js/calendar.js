// ========== 日程（Calendar）模块 ==========

let calendarInitialized = false;
let calendarCurrentUserId = null;
let calendarCurrentUsername = null;

// 视图状态
let calendarView = 'month'; // 'day' | 'week' | 'month'
let calendarViewDate = new Date(); // 当前视图聚焦的日期
let calendarSelectedDate = new Date(); // 用户选中的日期（用于左侧列表）
let calendarActiveEventId = null;
let calendarActiveEventDetail = null;

// 日程数据（已加载到当前视图窗口）
let calendarEvents = [];

// 参与者搜索相关
let calendarParticipantSearchTimer = null;

// 弹窗内状态
let calendarFormState = {
  participants: [],
  meetingEnabled: false,
  meetingType: 'wemeet',
  participantSearchTimer: null,
};

// ---------- 工具函数 ----------

function calendarPad(n) {
  return String(n).padStart(2, '0');
}

function calendarDateStr(d) {
  return `${d.getFullYear()}-${calendarPad(d.getMonth() + 1)}-${calendarPad(d.getDate())}`;
}

function calendarParseEventTime(timeStr) {
  if (!timeStr) return null;
  // "YYYY-MM-DD HH:MM:SS"
  const parts = timeStr.split(' ');
  if (parts.length < 2) return null;
  const [datePart, timePart] = parts;
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s] = timePart.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, s || 0);
}

function calendarIsSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function calendarIsToday(d) {
  return calendarIsSameDay(d, new Date());
}

function calendarStartOfWeek(d) {
  // 周一作为一周的开始
  const result = new Date(d);
  const day = result.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function calendarEndOfWeek(d) {
  const result = calendarStartOfWeek(d);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}

function calendarStartOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function calendarEndOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function calendarAddDays(d, days) {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarAddMonths(d, months) {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

// 把 src 日的"日"部分保持不变，截断到 ref 月份的合法范围内
function clampDateToMonth(src, ref) {
  const result = new Date(ref);
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(src.getDate(), lastDay));
  return result;
}

function calendarDayLabel(dateStr) {
  if (!dateStr) return '';
  const today = calendarDateStr(new Date());
  const tomorrow = calendarDateStr(calendarAddDays(new Date(), 1));
  if (dateStr === today) return '今天';
  if (dateStr === tomorrow) return '明天';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function calendarWeekdayLabel(d) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

function calendarFormatTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(' ');
  if (parts.length < 2) return timeStr;
  return parts[1].substring(0, 5);
}

function calendarToDateTimeLocal(timeStr) {
  if (!timeStr) return '';
  return timeStr.replace(' ', 'T').substring(0, 16);
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ---------- 本地缓存 ----------
// 策略：按用户隔离，缓存"全量已知日程"（仅 active）。切换视图/日期时先用缓存命中范围秒显，
// 再请求网络拿到该范围最新数据，覆盖缓存中该范围的旧数据后写回。
const CALENDAR_CACHE_PREFIX = 'calendar_events_';
const CALENDAR_CACHE_VERSION_KEY = 'calendar_cache_version';
const CALENDAR_CACHE_VERSION = 1; // 缓存结构版本，变更时自动失效

function calendarCacheKey() {
  return `${CALENDAR_CACHE_PREFIX}${calendarCurrentUserId || 'default'}`;
}

// 检查缓存版本，不匹配则清空所有日程缓存
function checkCalendarCacheVersion() {
  try {
    const v = localStorage.getItem(CALENDAR_CACHE_VERSION_KEY);
    if (v !== String(CALENDAR_CACHE_VERSION)) {
      clearCalendarCache();
      localStorage.setItem(CALENDAR_CACHE_VERSION_KEY, String(CALENDAR_CACHE_VERSION));
    }
  } catch (e) {
    console.warn('[Calendar] 缓存版本检查失败:', e);
  }
}

function loadCalendarCacheAll() {
  try {
    const raw = localStorage.getItem(calendarCacheKey());
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[Calendar] 缓存读取失败:', e);
    return [];
  }
}

function saveCalendarCacheAll(events) {
  try {
    localStorage.setItem(calendarCacheKey(), JSON.stringify(events || []));
  } catch (e) {
    console.warn('[Calendar] 缓存写入失败:', e);
  }
}

function clearCalendarCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CALENDAR_CACHE_PREFIX) || k === CALENDAR_CACHE_VERSION_KEY)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[Calendar] 缓存清理失败:', e);
  }
}

// 从缓存中取出 startTime 落在 [startDate, endDate] 范围内的日程
function getCachedEventsInRange(startDate, endDate) {
  const all = loadCalendarCacheAll();
  if (!all.length) return null;
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const hit = all.filter((ev) => {
    const st = calendarParseEventTime(ev.startTime);
    if (!st) return false;
    const ms = st.getTime();
    return ms >= startMs && ms <= endMs;
  });
  return hit;
}

// 用某范围的最新数据覆盖缓存中该范围的旧数据，并按 id 去重后写回
function updateCalendarCacheRange(startDate, endDate, freshEvents) {
  const all = loadCalendarCacheAll();
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const freshIds = new Set((freshEvents || []).map((ev) => ev.id));
  // 保留：不在本次范围内 且 id 未被本次结果覆盖 的旧事件
  const kept = all.filter((ev) => {
    if (freshIds.has(ev.id)) return false;
    const st = calendarParseEventTime(ev.startTime);
    if (!st) return true;
    const ms = st.getTime();
    return !(ms >= startMs && ms <= endMs);
  });
  saveCalendarCacheAll(kept.concat(freshEvents || []));
}

// ---------- 初始化 ----------

async function initCalendar() {
  if (calendarInitialized) return;
  calendarInitialized = true;

  try {
    const profileResult = await window.electronAPI.getProfile();
    if (profileResult.success) {
      calendarCurrentUserId = profileResult.profile.id;
      calendarCurrentUsername = profileResult.profile.username;
    }
  } catch (err) {
    console.error('[Calendar] 获取用户信息失败:', err);
  }

  // 用户信息就绪后再校验缓存版本（缓存键依赖 userId）
  checkCalendarCacheVersion();

  bindCalendarEvents();
  await loadCalendarView();
}

function bindCalendarEvents() {
  // 月份切换
  const prevMonthBtn = document.getElementById('calendarPrevMonthBtn');
  const nextMonthBtn = document.getElementById('calendarNextMonthBtn');
  if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => {
    calendarViewDate = calendarAddMonths(calendarViewDate, -1);
    // 同步选中日期为视图日期所在月的同一天（若超界则取月末）
    calendarSelectedDate = clampDateToMonth(calendarSelectedDate, calendarViewDate);
    loadCalendarView();
  });
  if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => {
    calendarViewDate = calendarAddMonths(calendarViewDate, 1);
    calendarSelectedDate = clampDateToMonth(calendarSelectedDate, calendarViewDate);
    loadCalendarView();
  });

  // 回到今天
  const todayBtn = document.getElementById('calendarTodayBtn');
  if (todayBtn) todayBtn.addEventListener('click', () => {
    const now = new Date();
    calendarViewDate = now;
    calendarSelectedDate = now;
    loadCalendarView();
  });

  // 主区上一段/下一段
  const prevBtn = document.getElementById('calendarPrevBtn');
  const nextBtn = document.getElementById('calendarNextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (calendarView === 'day') calendarViewDate = calendarAddDays(calendarViewDate, -1);
    else if (calendarView === 'week') calendarViewDate = calendarAddDays(calendarViewDate, -7);
    else calendarViewDate = calendarAddMonths(calendarViewDate, -1);
    loadCalendarView();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (calendarView === 'day') calendarViewDate = calendarAddDays(calendarViewDate, 1);
    else if (calendarView === 'week') calendarViewDate = calendarAddDays(calendarViewDate, 7);
    else calendarViewDate = calendarAddMonths(calendarViewDate, 1);
    loadCalendarView();
  });

  // 视图切换
  document.querySelectorAll('.calendar-view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const v = tab.getAttribute('data-view');
      if (v === calendarView) return;
      calendarView = v;
      document.querySelectorAll('.calendar-view-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-view') === v));
      // 切换视图时，将选中日期同步为视图日期
      calendarSelectedDate = new Date(calendarViewDate);
      loadCalendarView();
    });
  });

  // 新建日程按钮
  const createBtn = document.getElementById('calendarCreateBtn');
  if (createBtn) createBtn.addEventListener('click', openCalendarCreateModal);

  // 详情关闭按钮
  const detailCloseBtn = document.getElementById('calendarDetailCloseBtn');
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', () => {
    const panel = document.getElementById('calendarDetailPanel');
    if (panel) panel.style.display = 'none';
    calendarActiveEventId = null;
    calendarActiveEventDetail = null;
  });

  // 创建/编辑弹窗事件
  bindEventModalEvents();
  // 添加参与者弹窗事件
  bindAddParticipantModalEvents();
}

// ---------- 加载视图数据 ----------

/**
 * 计算当前视图下"必须加载"的日程时间范围。
 * 默认按视图（day/week/month）取窗口；并把 calendarSelectedDate 兜底纳入，
 * 避免用户在 mini 日历点击非当前视图范围内的日期时，左侧"当日日程"列表拿不到数据。
 */
function getCalendarLoadRange() {
  let startDate, endDate;
  if (calendarView === 'day') {
    const d = new Date(calendarViewDate);
    d.setHours(0, 0, 0, 0);
    startDate = d;
    endDate = new Date(d);
    endDate.setHours(23, 59, 59, 999);
  } else if (calendarView === 'week') {
    startDate = calendarStartOfWeek(calendarViewDate);
    endDate = calendarEndOfWeek(calendarViewDate);
  } else {
    // month 视图：扩展到完整的月历网格（包含上月末尾和下月开头的几行）
    const monthStart = calendarStartOfMonth(calendarViewDate);
    const monthEnd = calendarEndOfMonth(calendarViewDate);
    startDate = calendarStartOfWeek(monthStart);
    endDate = calendarEndOfWeek(monthEnd);
  }
  if (calendarSelectedDate) {
    const selStart = new Date(calendarSelectedDate);
    selStart.setHours(0, 0, 0, 0);
    const selEnd = new Date(calendarSelectedDate);
    selEnd.setHours(23, 59, 59, 999);
    if (selStart < startDate) startDate = selStart;
    if (selEnd > endDate) endDate = selEnd;
  }
  return { startDate, endDate };
}

// 渲染所有视图组件
function renderCalendarAll() {
  renderCalendarMini();
  renderCalendarMain();
  renderCalendarDayScheduleList();
  renderCalendarDetailPanel();
}

async function loadCalendarView() {
  const { startDate, endDate } = getCalendarLoadRange();

  // 阶段一：先用本地缓存命中范围内的数据秒显（离线/弱网也能立即看到上次的日程）
  const cached = getCachedEventsInRange(startDate, endDate);
  if (cached && cached.length) {
    calendarEvents = cached;
    renderCalendarAll();
  }

  // 阶段二：请求网络拿到最新数据并覆盖缓存，再重渲染
  await loadCalendarEvents(startDate, endDate);
  renderCalendarAll();
}

async function loadCalendarEvents(startDate, endDate) {
  const startDateStr = calendarDateStr(startDate);
  const endDateStr = calendarDateStr(endDate);

  try {
    const result = await window.electronAPI.calendarGetEvents({
      startDate: startDateStr,
      endDate: endDateStr,
      status: 'active', // 视图内仅显示进行中
    });
    if (result.success && result.data) {
      calendarEvents = result.data;
      // 网络成功：用最新数据覆盖缓存中该范围的旧数据
      updateCalendarCacheRange(startDate, endDate, result.data);
    } else {
      calendarEvents = [];
    }
  } catch (err) {
    console.error('[Calendar] 加载日程失败:', err);
    // 网络失败：退回使用缓存中该范围的数据，保证离线可用
    const fallback = getCachedEventsInRange(startDate, endDate);
    calendarEvents = (fallback && fallback.length) ? fallback : [];
  }

  // 额外查询当前已选中日程的状态（包括已取消的）
  if (calendarActiveEventId) {
    try {
      const detailRes = await window.electronAPI.calendarGetEventDetail(calendarActiveEventId);
      if (detailRes.success && detailRes.data) {
        calendarActiveEventDetail = detailRes.data;
      }
    } catch (err) {
      // ignore
    }
  }
}

// ---------- 左侧：紧凑月历 ----------

function renderCalendarMini() {
  // 标题
  const titleEl = document.getElementById('calendarMiniTitle');
  if (titleEl) titleEl.textContent = `${calendarViewDate.getFullYear()}年${calendarViewDate.getMonth() + 1}月`;

  // 网格
  const grid = document.getElementById('calendarMiniGrid');
  if (!grid) return;

  const monthStart = calendarStartOfMonth(calendarViewDate);
  const gridStart = calendarStartOfWeek(monthStart);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = calendarAddDays(gridStart, i);
    const dateStr = calendarDateStr(day);
    const isCurrentMonth = day.getMonth() === calendarViewDate.getMonth();
    const isToday = calendarIsToday(day);
    const isSelected = calendarIsSameDay(day, calendarSelectedDate);

    // 收集这一天的日程（仅 active）
    const dayEvents = calendarEvents.filter((ev) => {
      const st = calendarParseEventTime(ev.startTime);
      return st && calendarIsSameDay(st, day);
    });
    const dots = dayEvents.slice(0, 3).map((ev) => {
      const cls = ev.status === 'cancelled' ? 'is-cancelled' : (ev.meeting ? 'has-meeting' : '');
      return `<span class="calendar-mini-cell-dot ${cls}"></span>`;
    }).join('');
    const more = dayEvents.length > 3 ? `<div class="calendar-mini-cell-more">+${dayEvents.length - 3}</div>` : '';

    cells.push(`
      <div class="calendar-mini-cell ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-date="${dateStr}">
        <div class="calendar-mini-cell-date">${day.getDate()}</div>
        <div class="calendar-mini-cell-dots">${dots}</div>
        ${more}
      </div>
    `);
  }
  grid.innerHTML = cells.join('');

  // 点击日期
  grid.querySelectorAll('.calendar-mini-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dateStr = cell.getAttribute('data-date');
      if (!dateStr) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      calendarSelectedDate = new Date(y, m - 1, d);
      // 跳转视图：若选了非本月日期，跳转到对应月；切换到日视图
      if (calendarSelectedDate.getMonth() !== calendarViewDate.getMonth() || calendarSelectedDate.getFullYear() !== calendarViewDate.getFullYear()) {
        calendarViewDate = new Date(calendarSelectedDate);
      }
      loadCalendarView();
    });
  });
}

// ---------- 左侧：选中日期的日程列表 ----------

function renderCalendarDayScheduleList() {
  const titleEl = document.getElementById('calendarDayScheduleTitle');
  const listEl = document.getElementById('calendarDayScheduleList');
  if (!listEl) return;

  const dateStr = calendarDateStr(calendarSelectedDate);
  if (titleEl) titleEl.textContent = `${calendarDayLabel(dateStr)} · ${dateStr}`;

  const dayEvents = calendarEvents.filter((ev) => {
    const st = calendarParseEventTime(ev.startTime);
    return st && calendarIsSameDay(st, calendarSelectedDate);
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  if (dayEvents.length === 0) {
    listEl.innerHTML = `<div class="calendar-day-schedule-empty">当日无日程</div>`;
    return;
  }

  listEl.innerHTML = dayEvents.map((ev) => {
    const isCancelled = ev.status === 'cancelled';
    const isOrganizer = ev.organizerId === calendarCurrentUserId;
    const start = calendarFormatTime(ev.startTime);
    const end = calendarFormatTime(ev.endTime);
    const isActive = ev.id === calendarActiveEventId;
    return `
      <div class="calendar-day-schedule-item ${isCancelled ? 'is-cancelled' : ''}" data-event-id="${escapeHtml(ev.id)}" style="${isActive ? 'background:#e6efff;' : ''}">
        <div class="calendar-day-schedule-item-time">${escapeHtml(start)} - ${escapeHtml(end)}</div>
        <div class="calendar-day-schedule-item-body">
          <div class="calendar-day-schedule-item-title">${escapeHtml(ev.title || '未命名日程')}</div>
          <div class="calendar-day-schedule-item-meta">
            ${ev.meeting ? '会议 · ' : ''}${escapeHtml(ev.location || '')}
            ${isOrganizer ? ' · 组织者' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.calendar-day-schedule-item').forEach((item) => {
    item.addEventListener('click', () => {
      const eventId = item.getAttribute('data-event-id');
      if (eventId) selectCalendarEvent(eventId);
    });
  });
}

// ---------- 主区域 ----------

// 日/周视图默认滚动到的起始小时（8点），避免每次都从 0 点开始显示
const CALENDAR_DEFAULT_START_HOUR = 8;

// 将日/周视图的时间网格默认滚动到 8 点位置
function scrollCalendarToDefaultHour(body) {
  const grid = body.querySelector('.calendar-week-grid, .calendar-day-grid');
  if (!grid) return;
  const hourHeight = 48; // 与渲染时保持一致
  grid.scrollTop = CALENDAR_DEFAULT_START_HOUR * hourHeight;
}

function renderCalendarMain() {
  const body = document.getElementById('calendarMainBody');
  const titleEl = document.getElementById('calendarMainTitle');
  if (!body) return;

  if (calendarView === 'day') {
    if (titleEl) titleEl.textContent = `${calendarViewDate.getMonth() + 1}月${calendarViewDate.getDate()}日 ${'日一二三四五六'[calendarViewDate.getDay()]}`;
    body.innerHTML = renderDayView();
    bindDayViewEvents();
    scrollCalendarToDefaultHour(body);
  } else if (calendarView === 'week') {
    const start = calendarStartOfWeek(calendarViewDate);
    const end = calendarEndOfWeek(calendarViewDate);
    if (titleEl) titleEl.textContent = `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
    body.innerHTML = renderWeekView(start);
    bindWeekViewEvents();
    scrollCalendarToDefaultHour(body);
  } else {
    if (titleEl) titleEl.textContent = `${calendarViewDate.getFullYear()}年${calendarViewDate.getMonth() + 1}月`;
    body.innerHTML = renderMonthView();
    bindMonthViewEvents();
  }
}

// ---------- 周视图 ----------

function renderWeekView(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(calendarAddDays(weekStart, i));

  // 头部
  let html = '<div class="calendar-week-view">';
  html += '<div class="calendar-week-header">';
  html += '<div class="calendar-week-header-spacer"></div>';
  days.forEach((d) => {
    const isToday = calendarIsToday(d);
    html += `
      <div class="calendar-week-day-header ${isToday ? 'is-today' : ''}">
        <div class="calendar-week-day-label">${calendarWeekdayLabel(d)}</div>
        <div class="calendar-week-day-date">${d.getDate()}</div>
      </div>
    `;
  });
  html += '</div>';

  // 主体：24小时 × 7天
  html += '<div class="calendar-week-grid">';
  // 时间列
  html += '<div class="calendar-week-time-col">';
  for (let h = 0; h < 24; h++) {
    html += `<div class="calendar-week-time-cell" data-time="${calendarPad(h)}:00"></div>`;
  }
  html += '</div>';

  // 每天一列
  const hourHeight = 48; // px
  days.forEach((d) => {
    const isToday = calendarIsToday(d);
    html += `<div class="calendar-week-day-col ${isToday ? 'is-today' : ''}" data-date="${calendarDateStr(d)}">`;
    // 小时背景格
    for (let h = 0; h < 24; h++) {
      html += `<div class="calendar-week-hour-cell"></div>`;
    }
    // 渲染该天的日程
    const dayEvents = calendarEvents.filter((ev) => {
      const st = calendarParseEventTime(ev.startTime);
      return st && calendarIsSameDay(st, d);
    });
    dayEvents.forEach((ev) => {
      const st = calendarParseEventTime(ev.startTime);
      const et = calendarParseEventTime(ev.endTime);
      if (!st) return;
      // 跨天处理：结束时间超过当天 24:00，截断
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(24, 0, 0, 0);
      const segStart = st < dayStart ? dayStart : st;
      const segEnd = et > dayEnd ? dayEnd : et;
      const startMin = segStart.getHours() * 60 + segStart.getMinutes();
      const endMin = segEnd.getHours() * 60 + segEnd.getMinutes();
      const top = (startMin / 60) * hourHeight;
      const height = ((endMin - startMin) / 60) * hourHeight;
      if (height <= 0) return;
      const isCancelled = ev.status === 'cancelled';
      const isOrganizer = ev.organizerId === calendarCurrentUserId;
      html += `
        <div class="calendar-week-event ${isCancelled ? 'is-cancelled' : ''} ${isOrganizer ? 'is-organizing' : ''}"
             data-event-id="${escapeHtml(ev.id)}"
             style="top:${top}px;height:${Math.max(height, 20)}px;${isCancelled ? '' : (isOrganizer ? 'background:#1e6fff;' : 'background:#5b8def;')}">
          <div class="calendar-week-event-time">${escapeHtml(calendarFormatTime(ev.startTime))} - ${escapeHtml(calendarFormatTime(ev.endTime))}</div>
          <div class="calendar-week-event-title">${escapeHtml(ev.title || '')}</div>
        </div>
      `;
    });
    // 当前时刻红线
    if (isToday) {
      const now = new Date();
      const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * hourHeight;
      html += `<div class="calendar-week-now-line" style="top:${nowTop}px;"></div>`;
    }
    html += '</div>';
  });
  html += '</div>'; // grid
  html += '</div>'; // week-view
  return html;
}

function bindWeekViewEvents() {
  document.querySelectorAll('.calendar-week-event').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventId = el.getAttribute('data-event-id');
      if (eventId) selectCalendarEvent(eventId);
    });
  });
}

// ---------- 日视图 ----------

function renderDayView() {
  const d = calendarViewDate;
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
  const hourHeight = 48;
  const dayEvents = calendarEvents.filter((ev) => {
    const st = calendarParseEventTime(ev.startTime);
    return st && calendarIsSameDay(st, d);
  });

  let html = '<div class="calendar-day-view">';
  html += '<div class="calendar-day-header">';
  html += `<div class="calendar-day-header-title">${d.getMonth() + 1}月${d.getDate()}日 · ${calendarWeekdayLabel(d)}</div>`;
  html += `<div class="calendar-day-header-date">${d.getFullYear()}年 · ${dayEvents.length} 个日程</div>`;
  html += '</div>';
  html += '<div class="calendar-day-grid">';
  html += '<div class="calendar-day-time-col">';
  for (let h = 0; h < 24; h++) {
    html += `<div class="calendar-day-time-cell" data-time="${calendarPad(h)}:00"></div>`;
  }
  html += '</div>';
  html += '<div class="calendar-day-events-col">';
  for (let h = 0; h < 24; h++) {
    html += `<div class="calendar-day-hour-cell"></div>`;
  }
  dayEvents.forEach((ev) => {
    const st = calendarParseEventTime(ev.startTime);
    const et = calendarParseEventTime(ev.endTime);
    if (!st) return;
    const startMin = st.getHours() * 60 + st.getMinutes();
    const endMin = et ? (et.getHours() * 60 + et.getMinutes()) : startMin + 60;
    const top = (startMin / 60) * hourHeight;
    const height = ((endMin - startMin) / 60) * hourHeight;
    const isCancelled = ev.status === 'cancelled';
    html += `
      <div class="calendar-day-event ${isCancelled ? 'is-cancelled' : ''}" data-event-id="${escapeHtml(ev.id)}" style="top:${top}px;height:${Math.max(height, 30)}px;">
        <div class="calendar-day-event-time">${escapeHtml(calendarFormatTime(ev.startTime))} - ${escapeHtml(calendarFormatTime(ev.endTime))}</div>
        <div class="calendar-day-event-title">${escapeHtml(ev.title || '')}</div>
        ${ev.location ? `<div class="calendar-day-event-loc">📍 ${escapeHtml(ev.location)}</div>` : ''}
      </div>
    `;
  });
  const now = new Date();
  if (calendarIsToday(d)) {
    const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * hourHeight;
    html += `<div class="calendar-week-now-line" style="top:${nowTop}px;"></div>`;
  }
  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function bindDayViewEvents() {
  document.querySelectorAll('.calendar-day-event').forEach((el) => {
    el.addEventListener('click', () => {
      const eventId = el.getAttribute('data-event-id');
      if (eventId) selectCalendarEvent(eventId);
    });
  });
}

// ---------- 月视图 ----------

function renderMonthView() {
  const monthStart = calendarStartOfMonth(calendarViewDate);
  const monthEnd = calendarEndOfMonth(calendarViewDate);
  const gridStart = calendarStartOfWeek(monthStart);
  const gridEnd = calendarEndOfWeek(monthEnd);

  let html = '<div class="calendar-month-view">';
  html += '<div class="calendar-month-header">';
  ['一', '二', '三', '四', '五', '六', '日'].forEach((w) => {
    html += `<div class="calendar-month-header-cell">${w}</div>`;
  });
  html += '</div>';

  html += '<div class="calendar-month-body">';
  let d = new Date(gridStart);
  while (d <= gridEnd) {
    const isCurrentMonth = d.getMonth() === calendarViewDate.getMonth();
    const isToday = calendarIsToday(d);
    const dateStr = calendarDateStr(d);
    const dayEvents = calendarEvents.filter((ev) => {
      const st = calendarParseEventTime(ev.startTime);
      return st && calendarIsSameDay(st, d);
    });
    const max = 3;
    const visible = dayEvents.slice(0, max);
    const moreCount = dayEvents.length - max;
    html += `<div class="calendar-month-cell ${isCurrentMonth ? '' : 'is-other-month'} ${isToday ? 'is-today' : ''}" data-date="${dateStr}">`;
    html += `<div class="calendar-month-cell-date">${d.getDate()}</div>`;
    visible.forEach((ev) => {
      const isCancelled = ev.status === 'cancelled';
      const hasMeeting = !!ev.meeting;
      html += `<div class="calendar-month-cell-event ${isCancelled ? 'is-cancelled' : ''} ${hasMeeting ? 'has-meeting' : ''}" data-event-id="${escapeHtml(ev.id)}" title="${escapeHtml(ev.title || '')}">${escapeHtml(calendarFormatTime(ev.startTime))} ${escapeHtml(ev.title || '')}</div>`;
    });
    if (moreCount > 0) {
      html += `<div class="calendar-month-cell-more" data-date="${dateStr}">+${moreCount} 个日程</div>`;
    }
    html += '</div>';
    d = calendarAddDays(d, 1);
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function bindMonthViewEvents() {
  document.querySelectorAll('.calendar-month-cell-event').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventId = el.getAttribute('data-event-id');
      if (eventId) selectCalendarEvent(eventId);
    });
  });
  document.querySelectorAll('.calendar-month-cell').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.calendar-month-cell-event')) return;
      const dateStr = el.getAttribute('data-date');
      if (!dateStr) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      calendarSelectedDate = new Date(y, m - 1, d);
      // 切换到日视图
      calendarView = 'day';
      calendarViewDate = new Date(calendarSelectedDate);
      document.querySelectorAll('.calendar-view-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-view') === 'day'));
      loadCalendarView();
    });
  });
  document.querySelectorAll('.calendar-month-cell-more').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateStr = el.getAttribute('data-date');
      if (!dateStr) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      calendarSelectedDate = new Date(y, m - 1, d);
      calendarView = 'day';
      calendarViewDate = new Date(calendarSelectedDate);
      document.querySelectorAll('.calendar-view-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-view') === 'day'));
      loadCalendarView();
    });
  });
}

// ---------- 详情面板 ----------

async function selectCalendarEvent(eventId) {
  calendarActiveEventId = eventId;
  // 重新加载以获取最新状态（复用视图范围 + 选中日期兜底）
  const { startDate, endDate } = getCalendarLoadRange();
  await loadCalendarEvents(startDate, endDate);
  // 重新拉取详情
  try {
    const result = await window.electronAPI.calendarGetEventDetail(eventId);
    if (result.success && result.data) {
      calendarActiveEventDetail = result.data;
    } else {
      calendarActiveEventDetail = null;
    }
  } catch (err) {
    calendarActiveEventDetail = null;
  }
  renderCalendarMini();
  renderCalendarDayScheduleList();
  renderCalendarMain();
  renderCalendarDetailPanel();
}

function renderCalendarDetailPanel() {
  const panel = document.getElementById('calendarDetailPanel');
  const content = document.getElementById('calendarDetailPanelContent');
  const titleEl = panel ? panel.querySelector('.calendar-detail-panel-title') : null;
  if (!panel || !content) return;

  if (!calendarActiveEventDetail) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  const ev = calendarActiveEventDetail;
  if (titleEl) titleEl.textContent = ev.title || '日程详情';

  const isOrganizer = ev.organizerId === calendarCurrentUserId;
  const isCancelled = ev.status === 'cancelled';
  const startDt = calendarParseEventTime(ev.startTime);
  const endDt = calendarParseEventTime(ev.endTime);
  const startDateLabel = startDt ? `${startDt.getFullYear()}年${startDt.getMonth() + 1}月${startDt.getDate()}日 ${calendarWeekdayLabel(startDt)}` : '-';
  const timeRange = `${calendarFormatTime(ev.startTime)} - ${calendarFormatTime(ev.endTime)}`;

  content.innerHTML = `
    <div class="calendar-detail-color-bar"></div>
    <h2 class="calendar-detail-panel-title-big">
      ${escapeHtml(ev.title || '未命名日程')}
      ${isCancelled ? '<span class="calendar-event-tag cancelled">已取消</span>' : ''}
    </h2>
    <div class="calendar-detail-meta">
      <div class="calendar-detail-meta-row">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.59L11 13.41V6h2v6.59l3.7 3.7-1.5 1.3z"/></svg>
        <div>
          <div>${escapeHtml(startDateLabel)}</div>
          <div style="color:#888;font-size:12px;margin-top:2px;">${escapeHtml(timeRange)}</div>
        </div>
      </div>
      ${ev.location ? `
      <div class="calendar-detail-meta-row">
        <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        <div>${escapeHtml(ev.location)}</div>
      </div>
      ` : ''}
      <div class="calendar-detail-meta-row">
        <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        <div>组织者：${escapeHtml(ev.organizerName || ev.organizerId || '-')}</div>
      </div>
    </div>

    <div class="calendar-detail-actions">
      ${isOrganizer && !isCancelled ? `
        <button class="calendar-action-btn" id="calendarPanelEditBtn">编辑</button>
        <button class="calendar-action-btn danger" id="calendarPanelCancelBtn">取消日程</button>
      ` : ''}
      ${ev.meeting && (ev.meeting.meetingCode || ev.meeting.joinUrl) && !isCancelled ? `
        <button class="calendar-action-btn primary" id="calendarPanelJoinBtn">加入会议</button>` : ''}
      ${ev.meeting && (ev.meeting.meetingSubject || ev.meeting.meetingCode || ev.meeting.joinUrl) && !isCancelled ? `
        <button class="calendar-action-btn" id="calendarPanelCopyBtn">复制参会链接</button>` : ''}
    </div>

    ${ev.description ? `
      <div class="calendar-detail-section-title">日程描述</div>
      <div class="calendar-detail-description">${escapeHtml(ev.description)}</div>
    ` : ''}

    ${ev.meeting ? renderMeetingCard(ev.meeting) : ''}

    <div class="calendar-participants-section">
      <div class="calendar-participants-title">
        <span>参与者（${(ev.participants || []).length}）</span>
        ${isOrganizer && !isCancelled ? '<button class="calendar-add-participant-btn" id="calendarPanelAddParticipantBtn">+ 添加</button>' : ''}
      </div>
      <div class="calendar-participants-list">
        ${(ev.participants || []).map((p) => {
          const initial = (p.username || '?').charAt(0).toUpperCase();
          const isSelf = p.userId === calendarCurrentUserId;
          const isOrganizerUser = p.userId === ev.organizerId;
          const statusLabel = { accepted: '已接受', pending: '待回复', declined: '已拒绝', tentative: '待定' }[p.status] || p.status;
          const canRemove = isOrganizer && !isOrganizerUser && !isCancelled;
          return `
            <div class="calendar-participant-item" data-user-id="${escapeHtml(p.userId)}">
              <div class="calendar-participant-avatar">${escapeHtml(initial)}</div>
              <div class="calendar-participant-info">
                <div class="calendar-participant-name">${escapeHtml(p.username || p.userId)}${isSelf ? ' (我)' : ''}${isOrganizerUser ? ' · 组织者' : ''}</div>
                <div class="calendar-participant-status ${escapeHtml(p.status)}">${escapeHtml(statusLabel)}</div>
              </div>
              ${canRemove ? `<button class="calendar-participant-remove" data-user-id="${escapeHtml(p.userId)}" data-username="${escapeHtml(p.username || '')}" title="移除">×</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div id="calendarPanelFreeBusy"></div>
    </div>
  `;

  // 绑定按钮
  const editBtn = document.getElementById('calendarPanelEditBtn');
  const cancelBtn = document.getElementById('calendarPanelCancelBtn');
  const joinBtn = document.getElementById('calendarPanelJoinBtn');
  const copyBtn = document.getElementById('calendarPanelCopyBtn');
  const addBtn = document.getElementById('calendarPanelAddParticipantBtn');

  if (editBtn) editBtn.addEventListener('click', () => openCalendarEditModal(ev));
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelCalendarEvent(ev));
  if (joinBtn) joinBtn.addEventListener('click', async () => {
    const meetingCode = ev.meeting && ev.meeting.meetingCode;
    if (!meetingCode) {
      alert('会议号为空，无法加入');
      return;
    }
    const originalText = joinBtn.textContent;
    joinBtn.disabled = true;
    joinBtn.textContent = '加入中...';
    try {
      const result = await window.electronAPI.joinMeeting(meetingCode, '', '');
      if (!result.success) alert(result.message || '加入会议失败');
    } catch (err) {
      alert('加入会议失败: ' + err.message);
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = originalText;
    }
  });
  if (copyBtn) copyBtn.addEventListener('click', () => copyMeetingInfo(ev.meeting));
  if (addBtn) addBtn.addEventListener('click', () => openAddParticipantModal(ev));

  // 参与者移除
  content.querySelectorAll('.calendar-participant-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-user-id');
      const username = btn.getAttribute('data-username');
      if (!confirm(`确定移除 ${username || '该用户'}？`)) return;
      try {
        const result = await window.electronAPI.calendarRemoveParticipant(ev.id, userId);
        if (result.success) {
          await selectCalendarEvent(ev.id);
        } else {
          alert(result.message || '移除失败');
        }
      } catch (err) {
        alert('移除失败: ' + err.message);
      }
    });
  });

  // 会议号点击复制
  content.querySelectorAll('.calendar-meeting-card-code').forEach((el) => {
    el.addEventListener('click', () => {
      const code = el.getAttribute('data-code');
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          const original = el.textContent;
          el.textContent = '已复制';
          setTimeout(() => { el.textContent = original; }, 1000);
        }).catch(() => {});
      }
    });
  });

  // 空闲时间
  if (ev.participants && ev.participants.length > 1 && ev.startTime && ev.endTime) {
    const otherIds = ev.participants
      .filter((p) => p.userId !== calendarCurrentUserId)
      .map((p) => p.userId)
      .slice(0, 5);
    if (otherIds.length > 0) {
      loadFreeBusyForEvent(ev, [calendarCurrentUserId, ...otherIds]);
    }
  }
}

function renderMeetingCard(meeting) {
  if (!meeting) return '';
  const isWemeet = meeting.meetingType === 'wemeet';
  const code = meeting.meetingCode || meeting.meetingId || '';
  return `
    <div class="calendar-detail-section-title" style="margin-top:16px;">关联会议</div>
    <div class="calendar-meeting-card">
      <div class="calendar-meeting-card-header">
        <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        ${isWemeet ? '腾讯会议' : '自定义会议'}${meeting.meetingSubject ? ' · ' + escapeHtml(meeting.meetingSubject) : ''}
      </div>
      ${code ? `
        <div class="calendar-meeting-card-row">
          <div class="calendar-meeting-card-label">会议号</div>
          <div class="calendar-meeting-card-value">
            <span class="calendar-meeting-card-code" data-code="${escapeHtml(code)}">${escapeHtml(code)}</span>
          </div>
        </div>
      ` : ''}
      ${meeting.joinUrl ? `
        <a href="${escapeHtml(meeting.joinUrl)}" target="_blank" class="calendar-meeting-card-link">加入会议</a>
      ` : ''}
    </div>
  `;
}

// ---------- 空闲时间 ----------

async function loadFreeBusyForEvent(ev, userIds) {
  if (!ev.startTime || !ev.endTime || !userIds || userIds.length === 0) return;
  const container = document.getElementById('calendarPanelFreeBusy');
  if (!container) return;

  container.innerHTML = '<div class="calendar-freebusy-bar"><div class="calendar-freebusy-title">参与者忙碌时段</div><div style="color:#999;">加载中...</div></div>';

  try {
    const result = await window.electronAPI.calendarGetFreeBusy({
      userIds,
      startTime: ev.startTime,
      endTime: ev.endTime,
    });
    if (!result.success || !result.data) {
      container.innerHTML = '';
      return;
    }
    const slots = result.data;
    if (slots.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="calendar-freebusy-bar">
        <div class="calendar-freebusy-title">参与者忙碌时段</div>
        <div class="calendar-freebusy-list">
          ${slots.map((s) => {
            const slotHtml = s.busySlots && s.busySlots.length > 0
              ? s.busySlots.map((bs) => `<span class="calendar-freebusy-slot">${escapeHtml((bs.startTime || '').split(' ')[1] || bs.startTime)}-${escapeHtml((bs.endTime || '').split(' ')[1] || bs.endTime)} ${escapeHtml(bs.title || '')}</span>`).join(' ')
              : '<span class="calendar-free-empty">空闲</span>';
            return `<div class="calendar-freebusy-item">${escapeHtml(s.username || s.userId)}：${slotHtml}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '';
  }
}

function copyMeetingInfo(meeting) {
  if (!meeting) return;
  const lines = [];
  if (meeting.meetingSubject) lines.push(`会议主题：${meeting.meetingSubject}`);
  if (meeting.meetingCode) lines.push(`会议号：${meeting.meetingCode}`);
  if (meeting.joinUrl) lines.push(`参会链接：${meeting.joinUrl}`);
  const text = lines.join('\n');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    alert('会议信息已复制');
  }).catch(() => {
    alert('复制失败，请手动复制');
  });
}

// ---------- 创建/编辑日程弹窗 ----------

function resetCalendarFormState() {
  calendarFormState = {
    participants: [],
    meetingEnabled: false,
    meetingType: 'wemeet',
    participantSearchTimer: null,
  };
}

function openCalendarCreateModal() {
  resetCalendarFormState();
  const modal = document.getElementById('calendarEventModal');
  const titleEl = document.getElementById('calendarEventModalTitle');
  const errorEl = document.getElementById('calendarEventError');
  if (!modal) return;

  titleEl.textContent = '新建日程';
  errorEl.textContent = '';

  document.getElementById('calendarEventTitle').value = '';
  document.getElementById('calendarEventDescription').value = '';

  // 默认时间：使用选中日期 +1 小时到 +2 小时
  const base = new Date(calendarSelectedDate);
  base.setHours(base.getHours() + 1, 0, 0, 0);
  const startDefault = new Date(base);
  const endDefault = new Date(base.getTime() + 60 * 60 * 1000);
  const toLocal = (d) => `${d.getFullYear()}-${calendarPad(d.getMonth() + 1)}-${calendarPad(d.getDate())}T${calendarPad(d.getHours())}:${calendarPad(d.getMinutes())}`;
  document.getElementById('calendarEventStart').value = toLocal(startDefault);
  document.getElementById('calendarEventEnd').value = toLocal(endDefault);
  document.getElementById('calendarEventLocation').value = '';

  // 创建模式：启用会议相关 UI
  const meetingToggle = document.getElementById('calendarEventMeetingEnabled');
  const meetingSection = document.getElementById('calendarMeetingSection');
  const meetingSubjectInput = document.getElementById('calendarEventMeetingSubject');
  if (meetingToggle) {
    meetingToggle.checked = false;
    meetingToggle.disabled = false;
  }
  if (meetingSection) {
    meetingSection.style.display = 'none';
  }
  if (meetingSubjectInput) {
    meetingSubjectInput.value = '';
    meetingSubjectInput.disabled = false;
  }

  // 显示参与者搜索 UI
  const participantSearchContainer = document.getElementById('calendarEventParticipantSearch');
  if (participantSearchContainer && participantSearchContainer.parentElement) {
    participantSearchContainer.parentElement.style.display = '';
  }

  document.getElementById('calendarEventParticipantSearch').value = '';
  document.getElementById('calendarEventParticipantSearchResults').innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">输入关键词搜索用户</div>';
  renderFormSelectedParticipants();

  modal.setAttribute('data-mode', 'create');
  modal.removeAttribute('data-event-id');
  modal.classList.add('show');
}

function openCalendarEditModal(ev) {
  resetCalendarFormState();
  const modal = document.getElementById('calendarEventModal');
  const titleEl = document.getElementById('calendarEventModalTitle');
  const errorEl = document.getElementById('calendarEventError');
  if (!modal) return;

  titleEl.textContent = '编辑日程';
  errorEl.textContent = '';

  document.getElementById('calendarEventTitle').value = ev.title || '';
  document.getElementById('calendarEventDescription').value = ev.description || '';
  document.getElementById('calendarEventLocation').value = ev.location || '';
  document.getElementById('calendarEventStart').value = calendarToDateTimeLocal(ev.startTime);
  document.getElementById('calendarEventEnd').value = calendarToDateTimeLocal(ev.endTime);

  // 编辑模式：会议信息由创建时的 createMeeting 决定，不支持通过修改接口变更
  // 隐藏会议相关 UI（或显示为只读提示）
  const hasMeeting = !!ev.meeting;
  const meetingToggle = document.getElementById('calendarEventMeetingEnabled');
  const meetingSection = document.getElementById('calendarMeetingSection');
  if (meetingToggle) {
    meetingToggle.checked = false;
    meetingToggle.disabled = true; // 禁用编辑
  }
  if (meetingSection) {
    meetingSection.style.display = 'none';
  }
  if (hasMeeting) {
    // 如果已有关联会议，显示只读提示
    const meetingHint = document.getElementById('calendarEventMeetingSubject');
    if (meetingHint) {
      meetingHint.value = ev.meeting.meetingSubject ? `${ev.meeting.meetingSubject}（已有腾讯会议关联）` : '';
      meetingHint.disabled = true;
    }
  }

  // 编辑模式不支持修改参与者列表，隐藏参与者相关 UI
  calendarFormState.participants = [];
  renderFormSelectedParticipants();

  document.getElementById('calendarEventParticipantSearch').parentElement.style.display = 'none';

  modal.setAttribute('data-mode', 'edit');
  modal.setAttribute('data-event-id', ev.id);
  modal.classList.add('show');
}

function renderFormSelectedParticipants() {
  const container = document.getElementById('calendarFormSelectedParticipants');
  if (!container) return;
  if (calendarFormState.participants.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  container.innerHTML = calendarFormState.participants.map((u) => {
    const initial = (u.username || '?').charAt(0).toUpperCase();
    return `
      <span class="calendar-participant-item" style="display:inline-flex;width:auto;padding:4px 8px;">
        <div class="calendar-participant-avatar" style="width:20px;height:20px;font-size:10px;">${escapeHtml(initial)}</div>
        <span class="calendar-participant-name">${escapeHtml(u.username || u.id)}</span>
        <button class="calendar-participant-remove" data-user-id="${escapeHtml(u.id)}" title="移除">×</button>
      </span>
    `;
  }).join('');
}

async function searchUsersForCalendarForm(keyword) {
  const container = document.getElementById('calendarEventParticipantSearchResults');
  if (!container) return;
  if (!keyword.trim()) {
    container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">输入关键词搜索用户</div>';
    return;
  }
  container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索中...</div>';
  try {
    const result = await window.electronAPI.searchUsers(keyword);
    if (result.success && result.data) {
      const users = result.data;
      if (users.length === 0) {
        container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">未找到用户</div>';
        return;
      }
      container.innerHTML = users.map((user) => {
        const initial = (user.username || '?').charAt(0).toUpperCase();
        const isSelected = calendarFormState.participants.find((u) => u.id === user.id);
        return `
          <div class="calendar-participant-pick-item ${isSelected ? 'selected' : ''}" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-dept="${escapeHtml(user.departmentName || '')}">
            <div class="calendar-participant-pick-avatar">${escapeHtml(initial)}</div>
            <div class="calendar-participant-pick-info">
              <div class="calendar-participant-pick-name">${escapeHtml(user.username)}</div>
              <div class="calendar-participant-pick-dept">${escapeHtml(user.departmentName || user.id)}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索失败</div>';
    }
  } catch (err) {
    container.innerHTML = '<div style="padding:8px;text-align:center;color:#bbb;font-size:11px;">搜索失败</div>';
  }
}

async function submitCalendarEvent() {
  const modal = document.getElementById('calendarEventModal');
  const errorEl = document.getElementById('calendarEventError');
  errorEl.textContent = '';

  const title = document.getElementById('calendarEventTitle').value.trim();
  const description = document.getElementById('calendarEventDescription').value.trim();
  const startRaw = document.getElementById('calendarEventStart').value;
  const endRaw = document.getElementById('calendarEventEnd').value;
  const location = document.getElementById('calendarEventLocation').value.trim();

  if (!title) { errorEl.textContent = '请输入日程标题'; return; }
  if (title.length > 200) { errorEl.textContent = '标题不能超过 200 字符'; return; }
  if (description.length > 2000) { errorEl.textContent = '描述不能超过 2000 字符'; return; }
  if (!startRaw) { errorEl.textContent = '请选择开始时间'; return; }
  if (!endRaw) { errorEl.textContent = '请选择结束时间'; return; }
  if (new Date(startRaw) >= new Date(endRaw)) { errorEl.textContent = '结束时间必须晚于开始时间'; return; }
  if (location.length > 200) { errorEl.textContent = '地点不能超过 200 字符'; return; }

  // 检查是否勾选"创建腾讯会议"
  const createMeeting = document.getElementById('calendarEventMeetingEnabled').checked;

  const startTime = startRaw.replace('T', ' ') + ':00';
  const endTime = endRaw.replace('T', ' ') + ':00';
  const mode = modal.getAttribute('data-mode');
  const submitBtn = document.getElementById('calendarEventSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = '保存中...';

  try {
    let result;
    if (mode === 'edit') {
      // 编辑模式：仅支持修改 title/description/startTime/location
      // 会议信息由创建时的 createMeeting 决定，不支持通过修改接口变更
      const eventId = modal.getAttribute('data-event-id');
      const updateParams = {
        title,
        description: description || '',
        startTime,
        endTime,
        location: location || '',
      };
      result = await window.electronAPI.calendarUpdateEvent(eventId, updateParams);
    } else {
      // 创建模式：使用 createMeeting 布尔值，服务端负责创建腾讯会议
      const params = {
        title,
        description: description || undefined,
        startTime,
        endTime,
        location: location || undefined,
        participantIds: calendarFormState.participants.map((u) => u.id),
        createMeeting: createMeeting || undefined,
      };
      result = await window.electronAPI.calendarCreateEvent(params);
    }

    if (result.success) {
      modal.classList.remove('show');
      const newId = result.data && result.data.id;
      if (mode === 'edit') {
        await selectCalendarEvent(modal.getAttribute('data-event-id'));
      } else if (newId) {
        await selectCalendarEvent(newId);
      } else {
        await loadCalendarView();
      }
    } else {
      errorEl.textContent = result.message || '保存失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '保存失败';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '保存';
  }
}

// ---------- 取消日程 ----------

async function cancelCalendarEvent(ev) {
  if (!confirm(`确定取消日程「${ev.title}」？取消后数据保留。`)) return;
  try {
    const result = await window.electronAPI.calendarCancelEvent(ev.id);
    if (result.success) {
      await selectCalendarEvent(ev.id);
    } else {
      alert(result.message || '取消失败');
    }
  } catch (err) {
    alert('取消失败: ' + err.message);
  }
}

// ---------- 添加参与者弹窗 ----------

async function openAddParticipantModal(ev) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const errorEl = document.getElementById('calendarAddParticipantError');
  const searchInput = document.getElementById('calendarAddParticipantSearchInput');
  const resultsEl = document.getElementById('calendarAddParticipantSearchResults');
  if (!modal) return;
  errorEl.textContent = '';
  searchInput.value = '';
  resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">输入关键词搜索用户</div>';
  modal.setAttribute('data-event-id', ev.id);
  modal.classList.add('show');
  setTimeout(() => searchInput.focus(), 100);
}

async function searchUsersForAddParticipant(keyword) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const eventId = modal.getAttribute('data-event-id');
  const resultsEl = document.getElementById('calendarAddParticipantSearchResults');
  if (!keyword.trim()) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">输入关键词搜索用户</div>';
    return;
  }
  resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索中...</div>';
  try {
    const detailRes = await window.electronAPI.calendarGetEventDetail(eventId);
    const existingIds = new Set();
    if (detailRes.success && detailRes.data && detailRes.data.participants) {
      detailRes.data.participants.forEach((p) => existingIds.add(p.userId));
    }
    const result = await window.electronAPI.searchUsers(keyword);
    if (result.success && result.data) {
      const users = result.data.filter((u) => !existingIds.has(u.id));
      if (users.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">没有可添加的用户</div>';
        return;
      }
      resultsEl.innerHTML = users.map((user) => {
        const initial = (user.username || '?').charAt(0).toUpperCase();
        return `
          <div class="calendar-participant-pick-item" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">
            <div class="calendar-participant-pick-avatar">${escapeHtml(initial)}</div>
            <div class="calendar-participant-pick-info">
              <div class="calendar-participant-pick-name">${escapeHtml(user.username)}</div>
              <div class="calendar-participant-pick-dept">${escapeHtml(user.departmentName || user.id)}</div>
            </div>
            <button class="calendar-action-btn" data-add-btn="true">添加</button>
          </div>
        `;
      }).join('');
    } else {
      resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索失败</div>';
    }
  } catch (err) {
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">搜索失败</div>';
  }
}

async function handleAddParticipantClick(userId, username) {
  const modal = document.getElementById('calendarAddParticipantModal');
  const eventId = modal.getAttribute('data-event-id');
  const errorEl = document.getElementById('calendarAddParticipantError');
  errorEl.textContent = '';
  try {
    const result = await window.electronAPI.calendarAddParticipant(eventId, userId);
    if (result.success) {
      modal.classList.remove('show');
      await selectCalendarEvent(eventId);
    } else {
      errorEl.textContent = result.message || '添加失败';
    }
  } catch (err) {
    errorEl.textContent = err.message || '添加失败';
  }
}

// ---------- 弹窗事件绑定 ----------

function bindEventModalEvents() {
  const eventModal = document.getElementById('calendarEventModal');
  const cancelEventModalBtn = document.getElementById('calendarEventCancel');
  const submitEventBtn = document.getElementById('calendarEventSubmit');

  if (cancelEventModalBtn) {
    cancelEventModalBtn.addEventListener('click', () => eventModal.classList.remove('show'));
  }
  if (eventModal) {
    eventModal.addEventListener('click', (e) => {
      if (e.target.id === 'calendarEventModal') eventModal.classList.remove('show');
    });
  }
  if (submitEventBtn) {
    submitEventBtn.addEventListener('click', submitCalendarEvent);
  }

  const meetingToggle = document.getElementById('calendarEventMeetingEnabled');
  const meetingSection = document.getElementById('calendarMeetingSection');
  if (meetingToggle && meetingSection) {
    meetingToggle.addEventListener('change', (e) => {
      calendarFormState.meetingEnabled = e.target.checked;
      meetingSection.style.display = e.target.checked ? '' : 'none';
    });
  }

  const participantSearch = document.getElementById('calendarEventParticipantSearch');
  if (participantSearch) {
    participantSearch.addEventListener('input', (e) => {
      clearTimeout(calendarFormState.participantSearchTimer);
      const keyword = e.target.value.trim();
      calendarFormState.participantSearchTimer = setTimeout(() => {
        searchUsersForCalendarForm(keyword);
      }, 300);
    });
  }

  const participantResults = document.getElementById('calendarEventParticipantSearchResults');
  if (participantResults) {
    participantResults.addEventListener('click', (e) => {
      const item = e.target.closest('.calendar-participant-pick-item');
      if (!item) return;
      const userId = item.getAttribute('data-user-id');
      const username = item.getAttribute('data-username');
      const dept = item.getAttribute('data-dept');
      const existingIdx = calendarFormState.participants.findIndex((u) => u.id === userId);
      if (existingIdx >= 0) {
        calendarFormState.participants.splice(existingIdx, 1);
      } else {
        calendarFormState.participants.push({ id: userId, username, departmentName: dept });
      }
      renderFormSelectedParticipants();
      searchUsersForCalendarForm(document.getElementById('calendarEventParticipantSearch').value.trim());
    });
  }

  const formSelected = document.getElementById('calendarFormSelectedParticipants');
  if (formSelected) {
    formSelected.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.calendar-participant-remove');
      if (!removeBtn) return;
      const userId = removeBtn.getAttribute('data-user-id');
      const idx = calendarFormState.participants.findIndex((u) => u.id === userId);
      if (idx >= 0) calendarFormState.participants.splice(idx, 1);
      renderFormSelectedParticipants();
      const keyword = document.getElementById('calendarEventParticipantSearch').value.trim();
      if (keyword) searchUsersForCalendarForm(keyword);
    });
  }
}

function bindAddParticipantModalEvents() {
  const addParticipantModal = document.getElementById('calendarAddParticipantModal');
  const addParticipantClose = document.getElementById('calendarAddParticipantClose');
  const addParticipantSearch = document.getElementById('calendarAddParticipantSearchInput');
  const addParticipantResults = document.getElementById('calendarAddParticipantSearchResults');

  if (addParticipantClose) {
    addParticipantClose.addEventListener('click', () => addParticipantModal.classList.remove('show'));
  }
  if (addParticipantModal) {
    addParticipantModal.addEventListener('click', (e) => {
      if (e.target.id === 'calendarAddParticipantModal') addParticipantModal.classList.remove('show');
    });
  }
  if (addParticipantSearch) {
    addParticipantSearch.addEventListener('input', (e) => {
      clearTimeout(calendarParticipantSearchTimer);
      const keyword = e.target.value.trim();
      calendarParticipantSearchTimer = setTimeout(() => {
        searchUsersForAddParticipant(keyword);
      }, 300);
    });
  }
  if (addParticipantResults) {
    addParticipantResults.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-add-btn="true"]');
      if (!addBtn) return;
      const item = addBtn.closest('.calendar-participant-pick-item');
      if (!item) return;
      const userId = item.getAttribute('data-user-id');
      const username = item.getAttribute('data-username');
      addBtn.disabled = true;
      addBtn.textContent = '添加中...';
      try {
        await handleAddParticipantClick(userId, username);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = '添加';
      }
    });
  }
}

// ========== 暴露给全局 ==========

window.CalendarModule = {
  init: initCalendar,
  refresh: loadCalendarView,
};
