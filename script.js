

// --- State Management ---
let state = {
    currentView: 'dashboard',
    currentDate: new Date(),
    expenses: [], // {id, type: 'fixed'|'variable', name, amount, month: 'YYYY-MM', endMonth: 'YYYY-MM'|null}
    cards: [],    // {id, bank, type, last4, color, billingCycles: { 'YYYY-MM': {closingDay, dueDay} }}
    purchases: [], // {id, cardId, name, amount, isRecurring, installments, startMonth}
    selectedCardId: null,
    notificationsEnabled: true,
    alertsSeen: false,
    theme: localStorage.getItem('ff_theme') || 'light'
};

const COLOR_PALETTE = ['#38bdf8', '#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#94a3b8', '#1e293b'];

const ALL_ICONS = [
    'fa-cart-shopping', 'fa-basket-shopping', 'fa-utensils', 'fa-motorcycle', 'fa-gas-pump',
    'fa-bolt', 'fa-droplet', 'fa-wifi', 'fa-house-user', 'fa-heart-pulse',
    'fa-pills', 'fa-shirt', 'fa-bag-shopping', 'fa-clapperboard', 'fa-dumbbell',
    'fa-bus', 'fa-plane', 'fa-graduation-cap', 'fa-gift', 'fa-credit-card',
    'fa-burger', 'fa-coffee', 'fa-ice-cream', 'fa-pizza-slice', 'fa-car',
    'fa-scissors', 'fa-paw', 'fa-music', 'fa-gamepad', 'fa-camera'
];

function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const themeIcon = document.querySelector('#btn-theme-toggle-settings i');
    if (themeIcon) {
        themeIcon.className = state.theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('ff_theme', state.theme);
    applyTheme();
    if (navigator.vibrate) navigator.vibrate(20);
}

let notifiedToday = new Set(); // Cache para evitar bucles de notificaciones en la sesión

const CATEGORY_ICONS = {
    'supermercado': 'fa-basket-shopping',
    'comida': 'fa-utensils',
    'restaurante': 'fa-utensils',
    'delivery': 'fa-motorcycle',
    'combustible': 'fa-gas-pump',
    'nafta': 'fa-gas-pump',
    'servicio': 'fa-bolt',
    'luz': 'fa-bolt',
    'agua': 'fa-droplet',
    'internet': 'fa-wifi',
    'alquiler': 'fa-house-user',
    'salud': 'fa-heart-pulse',
    'farmacia': 'fa-pills',
    'ropa': 'fa-shirt',
    'shopping': 'fa-bag-shopping',
    'ocio': 'fa-clapperboard',
    'cine': 'fa-clapperboard',
    'gym': 'fa-dumbbell',
    'deporte': 'fa-volleyball',
    'transporte': 'fa-bus',
    'viaje': 'fa-plane',
    'educación': 'fa-graduation-cap',
    'regalo': 'fa-gift',
    'banco': 'fa-building-columns',
    'tarjeta': 'fa-credit-card'
};

function getLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const a = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastColor(hexColor) {
    if (!hexColor || hexColor.length < 7) return '#ffffff';
    return getLuminance(hexColor) > 0.5 ? '#000000' : '#ffffff';
}

function getCategoryIcon(name, manualIcon) {
    if (manualIcon) return manualIcon;
    const n = name.toLowerCase();
    for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
        if (n.includes(key)) return icon;
    }
    return 'fa-cart-shopping'; // icono por defecto
}

function renderIconPicker(containerId, inputId, currentIcon) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = ALL_ICONS.map(icon => `
        <div class="icon-option ${currentIcon === icon ? 'active' : ''}" 
             onclick="selectIcon('${containerId}', '${inputId}', '${icon}')">
            <i class="fa-solid ${icon}"></i>
        </div>
    `).join('');
}

function selectIcon(containerId, inputId, icon) {
    document.getElementById(inputId).value = icon;
    document.querySelectorAll(`#${containerId} .icon-option`).forEach(opt => {
        const i = opt.querySelector('i');
        opt.classList.toggle('active', i.classList.contains(icon));
    });
}

function getCardAlerts(cardId, amount) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card || amount <= 0) return null;

    const today = new Date();
    const currentDay = today.getDate();
    const ym = `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, '0')}`;
    const cycle = card.billingCycles[ym];

    if (!cycle) return null;

    const closing = parseInt(cycle.closingDay);
    const due = parseInt(cycle.dueDay);
    let alerts = [];

    // Check Closing
    if (closing >= currentDay && closing <= currentDay + 7) {
        const daysLeft = closing - currentDay;
        // Solo para el punto rojo y auditoría, la notificación real se dispara desde renderNotifications si hace falta
        alerts.push({ type: 'closing', days: daysLeft, label: daysLeft === 0 ? '¡Hoy cierra!' : `Cierra en ${daysLeft} días` });
    }

    // Check Due Date
    if (due >= currentDay && due <= currentDay + 7) {
        const daysLeft = due - currentDay;
        alerts.push({ type: 'due', days: daysLeft, label: daysLeft === 0 ? '¡Vence hoy!' : `Vence en ${daysLeft} días` });
    }

    return alerts.length > 0 ? alerts : null;
}

// Swipe for delete logic
let itemTouchStartX = 0;
let itemSwipedElement = null;

function handleItemTouchStart(e) {
    itemTouchStartX = e.touches[0].clientX;
    itemSwipedElement = e.currentTarget;
}

function handleItemTouchMove(e) {
    if (!itemTouchStartX || !itemSwipedElement) return;
    const touchX = e.touches[0].clientX;
    const diff = itemTouchStartX - touchX;

    // Solo permitimos deslizar hacia la izquierda
    if (diff > 0 && diff < 100) {
        itemSwipedElement.style.transform = `translateX(-${diff}px)`;
    }
}

function handleItemTouchEnd(e, id, type) {
    if (!itemTouchStartX || !itemSwipedElement) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = itemTouchStartX - touchEndX;

    if (diff > 70) {
        // Si desliza suficiente, mantenemos el botón visible o borramos
        itemSwipedElement.style.transform = `translateX(-80px)`;
    } else {
        itemSwipedElement.style.transform = `translateX(0)`;
    }
    itemTouchStartX = 0;
}

// --- Firebase Configuration ---
// REEMPLAZA ESTO CON TUS DATOS DE LA CONSOLA DE FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDDTgmBkEk2mI8jMY_oa1geLiA7TGposLA",
    authDomain: "finanzapp-d9867.firebaseapp.com",
    projectId: "finanzapp-d9867",
    storageBucket: "finanzapp-d9867.firebasestorage.app",
    messagingSenderId: "39346635170",
    appId: "1:39346635170:web:37cc70f0d94a446c7632fb"
};

// Inicializar Firebase (Compat Mode)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// --- Puente Google Identity Services -> Firebase Auth ---
window.handleCredentialResponse = (response) => {
    const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);

    auth.signInWithCredential(credential).then((result) => {
        const user = result.user;
        console.log("Sesión iniciada en Firebase:", user.displayName);

        localStorage.setItem('ff_user_session', JSON.stringify({
            id: user.uid,
            name: user.displayName,
            email: user.email,
            photo: user.photoURL
        }));

        document.getElementById('view-login').style.display = 'none';
        document.getElementById('main-app-container').classList.remove('hidden');

        startCloudSync(user.uid);
    }).catch((error) => {
        console.error("Error en Firebase Auth con Google:", error);
        alert("Error al sincronizar con Google. Revisa la consola.");
    });
};

const BANK_IDENTITIES = {
    'santander': '#ec0000',
    'galicia': '#ff8200',
    'bbva': '#004481',
    'macro': '#0050ff',
    'brubank': '#5e17eb',
    'icbc': '#c70007',
    'hsbc': '#db0011',
    'patagonia': '#00529b',
    'naranja x': '#ff4d00',
    'mercado pago': '#009ee3',
    'bna (banco nación)': '#0072bc',
    'hipotecario': '#00355f'
};

// Security: Sanitize user input to prevent XSS
function sanitize(str) {
    if (!str) return "";
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function init() {
    applyTheme();
    const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
    if (userSession.id) {
        document.getElementById('view-login').style.display = 'none';
        document.getElementById('main-app-container').classList.remove('hidden');

        if (userSession.id !== 'local') {
            startCloudSync(userSession.id);
        } else {
            loadData();
        }
    } else {
        document.getElementById('view-login').style.display = 'flex';
        document.getElementById('main-app-container').classList.add('hidden');
    }

    // Listener para autocompletar color de banco
    const bankInput = document.getElementById('card-bank');
    if (bankInput) {
        bankInput.addEventListener('change', (e) => {
            const val = e.target.value.toLowerCase();
            if (BANK_IDENTITIES[val]) {
                state.selectedColor = BANK_IDENTITIES[val];
                document.getElementById('card-color').value = state.selectedColor;
            }
            renderColorPicker();
        });
    }
}

function guestLogin() {
    let userName = prompt("¿Cuál es tu nombre?", "Invitado");
    if (!userName || userName.trim() === '') userName = "Invitado";

    localStorage.setItem('ff_user_session', JSON.stringify({
        id: 'local',
        name: userName.trim()
    }));
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('main-app-container').classList.remove('hidden');
    loadData();
}

function loadData() {
    const savedState = localStorage.getItem('finanzas_data_v3');
    if (savedState) {
        const parsed = JSON.parse(savedState);
        state.expenses = parsed.expenses || [];
        state.cards = parsed.cards || [];
        state.purchases = parsed.purchases || [];
        state.notificationsEnabled = parsed.notificationsEnabled !== undefined ? parsed.notificationsEnabled : true;
        state.currentDate = new Date();
    }
    renderColorPicker();
    renderDashboard();
}

function startCloudSync(uid) {
    updateSyncUI('syncing');

    db.collection('usuarios').doc(uid).onSnapshot((doc) => {
        if (doc.exists) {
            const cloudData = doc.data();
            console.log("Datos recibidos de la nube:", cloudData);

            state.expenses = cloudData.expenses || [];
            state.cards = cloudData.cards || [];
            state.purchases = cloudData.purchases || [];
            state.notificationsEnabled = cloudData.notificationsEnabled !== undefined ? cloudData.notificationsEnabled : true;

            saveDataLocalOnly();
            renderDashboard();
            updateSyncUI('synced');
        } else {
            console.log("No hay datos en la nube, subiendo los locales...");
            loadData();
            syncDataToCloud();
        }
    }, (error) => {
        console.error("Error en Snapshot:", error);
        updateSyncUI('error');
        loadData();
    });
}

function logout() {
    auth.signOut().then(() => {
        localStorage.removeItem('ff_user_session');
        location.reload();
    });
}

function wipeData() {
    if (confirm('⚠️ ¿Estás seguro de que quieres borrar TODOS tus datos? Esta acción no se puede deshacer.')) {
        state.expenses = [];
        state.cards = [];
        state.purchases = [];
        state.selectedCardId = null;
        saveData();
        renderDashboard();
        showView('dashboard');
        alert('Datos borrados exitosamente.');
    }
}

function saveData() {
    saveDataLocalOnly();
    syncDataToCloud();
}

function saveDataLocalOnly() {
    const data = {
        expenses: state.expenses,
        cards: state.cards,
        purchases: state.purchases,
        notificationsEnabled: state.notificationsEnabled
    };
    localStorage.setItem('finanzas_data_v3', JSON.stringify(data));
}

function syncDataToCloud() {
    const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
    if (!userSession.id || userSession.id === 'local') return;

    updateSyncUI('syncing');

    const dataToSave = {
        expenses: state.expenses,
        cards: state.cards,
        purchases: state.purchases,
        notificationsEnabled: state.notificationsEnabled,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('usuarios').doc(userSession.id).set(dataToSave, { merge: true })
        .then(() => {
            updateSyncUI('synced');
            if (navigator.vibrate) navigator.vibrate(10); // Feedback háptico muy sutil
        })
        .catch((e) => {
            console.error("Error al subir a la nube:", e);
            updateSyncUI('error');
        });
}

function updateSyncUI(status) {
    const container = document.getElementById('sync-icon-container');
    const text = document.getElementById('sync-text');
    if (!container || !text) return;

    if (status === 'syncing') {
        showSkeletons();
        container.innerHTML = `<i id="sync-icon" class="fa-solid fa-cloud-arrow-up fa-bounce fa-stack-2x" style="color: var(--primary);"></i>`;
        text.innerText = 'Sincronizando...';
    } else if (status === 'synced') {
        container.innerHTML = `
            <i id="sync-icon" class="fa-solid fa-cloud fa-stack-2x" style="color: var(--success);"></i>
            <i class="fa-solid fa-check fa-stack-1x" style="color: white; font-size: 0.6rem; transform: translateY(1px);"></i>
        `;
        text.innerText = 'Sincronizado';
    } else {
        container.innerHTML = `<i id="sync-icon" class="fa-solid fa-cloud-slash fa-stack-2x" style="color: var(--danger);"></i>`;
        text.innerText = 'Error Nube';
    }
}

function exportData() {
    const data = localStorage.getItem('finanzas_data_v3');
    if (!data) return alert('No hay datos para exportar.');
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mis_consumos_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.expenses && data.cards && data.purchases) {
                localStorage.setItem('finanzas_data_v3', JSON.stringify(data));
                alert('Datos importados correctamente. La página se recargará.');
                location.reload();
            } else {
                alert('El archivo no tiene el formato correcto.');
            }
        } catch (err) {
            alert('Error al leer el archivo.');
        }
    };
    reader.readAsText(file);
}

// --- Navigation ---
let shownAlerts = new Set(); // Para evitar bucles de notificaciones

function showView(viewId) {
    if (viewId === 'dashboard') {
        state.currentDate = new Date();
    }

    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
        if (nav.getAttribute('onclick')?.includes(`'${viewId}'`)) nav.classList.add('active');
    });
    state.currentView = viewId;

    if (viewId === 'settings') {
        const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
        const nameEl = document.getElementById('settings-user-name');
        const emailEl = document.getElementById('settings-user-email');
        const picEl = document.getElementById('user-profile-pic-settings');
        const btnNotif = document.getElementById('btn-notifications');

        if (nameEl) nameEl.innerText = userSession.name || 'Invitado';
        if (emailEl) emailEl.innerText = userSession.email || 'Local';

        if (picEl && userSession.photo) {
            picEl.innerHTML = `<img src="${userSession.photo}" style="width: 100%; height: 100%; object-fit: cover;">`;
        } else if (picEl) {
            picEl.innerHTML = `<i class="fa-solid fa-user"></i>`;
        }

        if (btnNotif) {
            btnNotif.className = 'btn-settings-outline'; // Base class
            btnNotif.style.opacity = '1';
            btnNotif.style.color = '';
            btnNotif.style.borderColor = '';

            if (Notification.permission === 'denied') {
                btnNotif.innerHTML = `<i class="fa-solid fa-bell-slash"></i> Permisos Bloqueados`;
                btnNotif.style.opacity = '0.5';
                btnNotif.onclick = () => alert("Habilita permisos en el navegador.");
            } else if (state.notificationsEnabled) {
                btnNotif.innerHTML = `<i class="fa-solid fa-bell-slash"></i> Desactivar Notificaciones`;
                btnNotif.onclick = toggleNotifications;
            } else {
                btnNotif.innerHTML = `<i class="fa-solid fa-bell"></i> Activar Notificaciones`;
                btnNotif.style.color = 'var(--primary)';
                btnNotif.style.borderColor = 'var(--primary)';
                btnNotif.onclick = requestNotificationPermission;
            }
        }
    }

    if (viewId === 'cards') {
        state.alertsSeen = true;
        const navDot = document.getElementById('nav-card-dot');
        if (navDot) navDot.style.display = 'none';
    }

    renderDashboard();
}

function changeMonth(direction) {
    state.currentDate.setMonth(state.currentDate.getMonth() + direction);
    renderDashboard();
    if (state.currentView === 'card-details') viewCardDetails(state.selectedCardId);
}

// --- Modals ---
function showModal(modalId, isEdit = false) {
    if (!isEdit) {
        const form = document.querySelector(`#${modalId} form`);
        if (form) form.reset();

        const now = state.currentDate;
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        if (modalId === 'modal-fixed') {
            document.getElementById('modal-fixed-title').innerText = 'Nuevo Gasto';
            document.getElementById('fixed-edit-id').value = '';
            document.getElementById('fixed-icon').value = '';
            renderIconPicker('icon-picker-fixed', 'fixed-icon', '');
            initPicker('picker-fixed-month', ym);
            initPicker('picker-fixed-end-month', '');
            document.getElementById('fixed-has-end').checked = false;
            document.getElementById('group-fixed-end').classList.add('hidden');
            document.getElementById('fixed-type').value = 'fixed';
            if (document.getElementById('group-fixed-end-wrap')) document.getElementById('group-fixed-end-wrap').style.display = 'block';
        } else if (modalId === 'modal-card') {
            document.getElementById('modal-card-title').innerText = 'Nueva Tarjeta';
            document.getElementById('card-edit-id').value = '';
            document.getElementById('btn-delete-card').style.display = 'none';
            selectColor('#38bdf8');
        } else if (modalId === 'modal-purchase') {
            document.getElementById('modal-purchase-title').innerText = 'Nueva Cuota';
            document.getElementById('purchase-edit-id').value = '';
            document.getElementById('purchase-icon').value = '';
            renderIconPicker('icon-picker-purchase', 'purchase-icon', '');
            initPicker('picker-purchase-start-month', ym);
        }
    }
    document.getElementById(modalId).classList.add('active');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

function showModalForMonth(modalId) {
    showModal(modalId);
    if (modalId === 'modal-fixed') {
        const year = state.currentDate.getFullYear();
        const month = String(state.currentDate.getMonth() + 1).padStart(2, '0');
        initPicker('picker-fixed-month', `${year}-${month}`);
    }
}

// --- Helpers ---
function renderColorPicker() {
    const container = document.getElementById('color-picker-ui');
    if (!container) return;

    const bankInput = document.getElementById('card-bank');
    const bankName = bankInput ? bankInput.value.toLowerCase() : '';
    const bankColor = BANK_IDENTITIES[bankName] || '#38bdf8';

    const currentColor = document.getElementById('card-color').value;

    let html = `
        <div class="color-option bank-identity ${currentColor === bankColor ? 'active' : ''}" 
             style="background: ${bankColor}" onclick="selectColor('${bankColor}')" data-color="${bankColor}">
             <i class="fa-solid fa-building-columns"></i>
        </div>
    `;

    html += COLOR_PALETTE.map(color => `
        <div class="color-option ${currentColor === color ? 'active' : ''}" 
             style="background: ${color}" onclick="selectColor('${color}')" data-color="${color}"></div>
    `).join('');

    container.innerHTML = html;
}

function selectColor(color) {
    document.getElementById('card-color').value = color;
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.color === color);
    });
}

function toggleInstallments(isRecurring) {
    const group = document.getElementById('group-installments');
    const input = document.getElementById('purchase-installments');
    if (isRecurring) {
        group.classList.add('hidden');
        input.removeAttribute('required');
    } else {
        group.classList.remove('hidden');
        input.setAttribute('required', '');
    }
}

// --- Custom Month Picker Logic ---
const MONTH_NAMES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function initPicker(pickerId, val) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;

    let year, month;
    if (val) {
        [year, month] = val.split('-').map(Number);
    } else {
        const now = state.currentDate;
        year = now.getFullYear();
        month = now.getMonth() + 1;
    }

    picker.dataset.year = year;
    picker.dataset.month = month;
    if (val) picker.querySelector('input').value = val;
    else picker.querySelector('input').value = '';

    renderPicker(pickerId);
}

function renderPicker(pickerId) {
    const picker = document.getElementById(pickerId);
    const container = picker.querySelector('.month-picker-container');
    const yearSpan = picker.querySelector('.year-selector span');

    const year = parseInt(picker.dataset.year);
    const selectedMonth = parseInt(picker.dataset.month);
    const hiddenInput = picker.querySelector('input');
    const currentValue = hiddenInput.value;

    yearSpan.innerText = year;

    container.innerHTML = MONTH_NAMES_SHORT.map((name, idx) => {
        const m = idx + 1;
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        const isActive = currentValue === ym;
        return `<button type="button" class="month-btn ${isActive ? 'active' : ''}" onclick="selectPickerMonth('${pickerId}', ${m})">${name}</button>`;
    }).join('');
}

function adjustPickerYear(pickerId, delta) {
    const picker = document.getElementById(pickerId);
    picker.dataset.year = parseInt(picker.dataset.year) + delta;
    renderPicker(pickerId);
}

function selectPickerMonth(pickerId, month) {
    const picker = document.getElementById(pickerId);
    const year = picker.dataset.year;
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    const hiddenInput = picker.querySelector('input');
    hiddenInput.value = ym;
    picker.dataset.month = month;

    renderPicker(pickerId);
}

function renderNotifications() {
    const navDot = document.getElementById('nav-card-dot');
    const { cardSummary } = getMonthlyStats();
    let hasAlerts = false;

    state.cards.forEach(card => {
        const amount = cardSummary[card.id] || 0;
        const alerts = getCardAlerts(card.id, amount);
        if (alerts) hasAlerts = true;
    });

    if (navDot) {
        if (hasAlerts && state.currentView !== 'cards' && !state.alertsSeen) {
            navDot.style.display = 'block';
        } else {
            navDot.style.display = 'none';
        }
    }
}

function renderCarouselDayPicker(containerId, inputId, selectedDay) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    for (let i = 1; i <= 31; i++) {
        html += `<div class="carousel-item" data-day="${i}">${i}</div>`;
    }
    container.innerHTML = html;

    const input = document.getElementById(inputId);
    const dayToSelect = parseInt(selectedDay) || 1;
    input.value = dayToSelect;

    // Scroll to initial position
    setTimeout(() => {
        const item = container.querySelector(`[data-day="${dayToSelect}"]`);
        if (item) {
            container.scrollLeft = item.offsetLeft - (container.offsetWidth / 2) + (item.offsetWidth / 2);
            updateCarouselActiveState(container, inputId);
        }
    }, 100);

    // Dynamic scroll detection
    container.onscroll = () => {
        clearTimeout(container.scrollTimeout);
        container.scrollTimeout = setTimeout(() => {
            updateCarouselActiveState(container, inputId);
        }, 50);
    };
}

function updateCarouselActiveState(container, inputId) {
    const items = container.querySelectorAll('.carousel-item');
    const containerCenter = container.scrollLeft + (container.offsetWidth / 2);
    let closestDay = 1;
    let minDiff = Infinity;

    items.forEach(item => {
        const itemCenter = item.offsetLeft + (item.offsetWidth / 2);
        const diff = Math.abs(containerCenter - itemCenter);

        if (diff < minDiff) {
            minDiff = diff;
            closestDay = parseInt(item.dataset.day);
        }
        item.classList.remove('active');
    });

    const activeItem = container.querySelector(`[data-day="${closestDay}"]`);
    if (activeItem && !activeItem.classList.contains('active')) {
        activeItem.classList.add('active');
        // Feedback háptico sutil
        if (navigator.vibrate) navigator.vibrate(15);
    }

    document.getElementById(inputId).value = closestDay;
}

// --- Core Logic ---
function getMonthlyStats() {
    const year = state.currentDate.getFullYear();
    const monthIdx = state.currentDate.getMonth();
    const currentYM = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const currentDateObj = new Date(year, monthIdx, 1);

    // Filter expenses (Fixed logic improved)
    const filteredExpenses = state.expenses.filter(e => {
        const start = new Date(e.month + '-02');
        if (e.type === 'variable') return e.month === currentYM;

        // Fixed: current >= start && (!end || current <= end)
        if (currentDateObj < new Date(start.getFullYear(), start.getMonth(), 1)) return false;
        if (e.endMonth) {
            const end = new Date(e.endMonth + '-02');
            if (currentDateObj > new Date(end.getFullYear(), end.getMonth(), 1)) return false;
        }
        return true;
    });

    const fixedTotal = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

    // Card totals
    let cardTotal = 0;
    const cardSummary = {};
    state.cards.forEach(c => cardSummary[c.id] = 0);

    state.purchases.forEach(p => {
        const start = new Date(p.startMonth + '-02');
        const diff = (year - start.getFullYear()) * 12 + (monthIdx - start.getMonth());
        if (diff >= 0) {
            if (p.isRecurring) {
                cardTotal += parseFloat(p.amount);
                cardSummary[p.cardId] += parseFloat(p.amount);
            } else if (diff < p.installments) {
                const quote = parseFloat(p.amount) / parseInt(p.installments);
                cardTotal += quote;
                cardSummary[p.cardId] += quote;
            }
        }
    });

    return { fixedTotal, cardTotal, cardSummary, filteredExpenses };
}

function getCardLogo(type) {
    const logos = {
        visa: '<i class="fa-brands fa-cc-visa visa"></i>',
        mastercard: '<i class="fa-brands fa-cc-mastercard mastercard"></i>',
        amex: '<i class="fa-brands fa-cc-amex amex"></i>'
    };
    return logos[type] || '<i class="fa-solid fa-credit-card"></i>';
}

function showSkeletons() {
    const list = document.getElementById('fixed-expenses-list');
    if (!list) return;

    let html = '';
    for (let i = 0; i < 3; i++) {
        html += `
            <div class="expense-item glass" style="opacity: 0.6; border: none;">
                <div class="icon-box skeleton" style="width: 40px; height: 40px; border-radius: 12px;"></div>
                <div class="expense-info">
                    <div class="skeleton" style="width: 120px; height: 16px; margin-bottom: 8px;"></div>
                    <div class="skeleton" style="width: 80px; height: 12px;"></div>
                </div>
                <div class="skeleton" style="width: 60px; height: 20px;"></div>
            </div>
        `;
    }
    list.innerHTML = html;
}

// --- Rendering ---
function renderDashboard() {
    const { fixedTotal, cardTotal, cardSummary, filteredExpenses } = getMonthlyStats();

    const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
    const greetingTitle = document.getElementById('dashboard-greeting-title');
    const dashboardPic = document.getElementById('user-profile-pic-dashboard');

    if (greetingTitle && userSession.name) {
        const firstName = userSession.name.split(' ')[0];
        greetingTitle.innerText = `Hola, ${sanitize(firstName)}! 👋`;
    }

    if (dashboardPic && userSession.photo) {
        dashboardPic.style.display = 'block';
        dashboardPic.innerHTML = `<img src="${userSession.photo}" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else if (dashboardPic) {
        dashboardPic.style.display = 'none';
    }

    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const dateText = `${months[state.currentDate.getMonth()]}, ${state.currentDate.getFullYear()}`;

    const currentText = document.getElementById('current-date-text');
    if (currentText) currentText.innerText = dateText;
    const statsText = document.getElementById('stats-date-text');
    if (statsText) statsText.innerText = dateText;

    document.getElementById('total-expense-display').innerText = `$${(fixedTotal + cardTotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('fixed-total-display').innerText = `$${fixedTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
    document.getElementById('cards-total-display').innerText = `$${cardTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const statsTotalDisplay = document.getElementById('stats-total-display');
    if (statsTotalDisplay) statsTotalDisplay.innerText = `$${(fixedTotal + cardTotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    renderNotifications();

    const list = document.getElementById('fixed-expenses-list');
    if (list) {
        let html = filteredExpenses.map(e => {
            let installmentText = '';
            if (e.type === 'fixed' && e.endMonth) {
                const start = new Date(e.month + '-02');
                const end = new Date(e.endMonth + '-02');
                const current = state.currentDate;

                const total = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                const cur = (current.getFullYear() - start.getFullYear()) * 12 + (current.getMonth() - start.getMonth()) + 1;

                installmentText = ` <span style="font-size: 0.75rem; background: rgba(56, 189, 248, 0.15); color: var(--primary); padding: 2px 8px; border-radius: 8px; margin-left: 6px; font-weight: 700;">${String(cur).padStart(2, '0')}/${String(total).padStart(2, '0')}</span>`;
            }

            const iconClass = getCategoryIcon(e.name, e.icon);

            return `
                <div class="swipe-item-container">
                    <div class="swipe-delete-action" onclick="deleteExpense('${e.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                    <div class="expense-item swipe-item-content" 
                         ontouchstart="handleItemTouchStart(event)" 
                         ontouchmove="handleItemTouchMove(event)" 
                         ontouchend="handleItemTouchEnd(event, '${e.id}', 'expense')">
                        <div class="icon-box" style="background: ${e.type === 'fixed' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(129, 140, 248, 0.1)'}; color: ${e.type === 'fixed' ? 'var(--primary)' : 'var(--secondary)'};">
                            <i class="fa-solid ${iconClass}"></i>
                        </div>
                        <div class="expense-info">
                            <div class="expense-name">${sanitize(e.name)}${installmentText}</div>
                            <div class="expense-category">${e.type === 'fixed' ? 'Gasto Fijo' : 'Gasto del Mes'} ${e.endMonth === (state.currentDate.getFullYear() + '-' + String(state.currentDate.getMonth() + 1).padStart(2, '0')) ? '⚠️ Finaliza' : ''}</div>
                        </div>
                        <div class="expense-amount">$${parseFloat(e.amount).toLocaleString('es-AR')}</div>
                        <button class="btn-action" onclick="editExpense('${e.id}')"><i class="fa-solid fa-pen"></i></button>
                    </div>
                </div>
            `;
        }).join('');

        if (cardTotal > 0) {
            html += `
                <div class="expense-item glass" onclick="showView('cards')" style="cursor: pointer; border-left: 4px solid var(--accent);">
                    <div class="icon-box" style="background: rgba(244, 114, 182, 0.1); color: var(--accent);">
                        <i class="fa-solid fa-credit-card"></i>
                    </div>
                    <div class="expense-info">
                        <div class="expense-name">Tarjetas de Crédito</div>
                        <div class="expense-category">Resumen consolidado</div>
                    </div>
                    <div class="expense-amount">$${cardTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
                    <i class="fa-solid fa-chevron-right" style="opacity: 0.3; margin-left:10px;"></i>
                </div>
            `;
        }
        list.innerHTML = html || '<p style="text-align:center; padding:40px; opacity:0.5;">Sin consumos en este mes</p>';
        const statsList = document.getElementById('stats-details-list');
        if (statsList) statsList.innerHTML = list.innerHTML;
    }

    // Cards List Full
    const cardsFull = document.getElementById('cards-list-full');
    if (cardsFull) {
        cardsFull.innerHTML = state.cards.map(c => {
            const ym = `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, '0')}`;
            const cycle = c.billingCycles[ym] || { closingDay: '--', dueDay: '--' };
            const amount = cardSummary[c.id] || 0;
            const alerts = getCardAlerts(c.id, amount);

            let alertHtml = '';
            if (alerts) {
                alertHtml = alerts.map(a => `
                    <div style="margin-top: 5px; font-size: 0.75rem; color: ${a.type === 'due' ? 'var(--danger)' : 'var(--primary)'}; display:flex; align-items:center; gap:5px; font-weight:600;">
                        <i class="fa-solid ${a.type === 'due' ? 'fa-circle-exclamation' : 'fa-calendar-check'}"></i>
                        ${a.label}
                    </div>
                `).join('');
            }

            return `
                <div style="margin-bottom: 12px;">
                    <div class="expense-item glass" onclick="viewCardDetails('${c.id}')" style="margin-bottom: 0;">
                        <div class="icon-box" style="background: ${c.color}22; color: ${c.color}; font-size: 1.8rem;">${getCardLogo(c.type)}</div>
                        <div class="expense-info">
                            <div class="expense-name">${sanitize(c.bank)}</div>
                            <div class="expense-category">Vto: ${cycle.dueDay} | Total: $${amount.toLocaleString('es-AR')}</div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="opacity: 0.3;"></i>
                    </div>
                    ${alertHtml}
                </div>
            `;
        }).join('') || '<p style="text-align:center; padding:40px; opacity:0.5;">No hay tarjetas registradas</p>';
    }
}

function viewCardDetails(cardId, animationClass) {
    state.selectedCardId = cardId;
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const monthName = months[state.currentDate.getMonth()];
    const ym = `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, '0')}`;
    const cycle = card.billingCycles[ym] || { closingDay: '---', dueDay: '---' };

    document.getElementById('detail-card-name').innerText = sanitize(card.bank);
    const hero = document.getElementById('card-hero-container');
    const hasMultipleCards = state.cards.length > 1;

    const contrastColor = getContrastColor(card.color);
    const badgeBg = contrastColor === '#ffffff' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';

    hero.innerHTML = `
        <div class="card-preview ${animationClass || ''}" id="card-swipe-target" 
             style="background: linear-gradient(135deg, ${card.color}, #1e293b); color: ${contrastColor};">
            <div class="card-logo-overlay" onclick="editCard('${card.id}')" style="cursor:pointer; color: ${contrastColor};">${getCardLogo(card.type)}</div>
            <div class="card-bank" style="color: ${contrastColor};">${sanitize(card.bank)}</div>
            <div class="card-chip"></div>
            <div class="card-number-display" style="color: ${contrastColor};">**** **** **** ${sanitize(card.last4)}</div>
            <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 600; margin-top: 10px; color: ${contrastColor};">
                <div onclick="openBillingModal()" style="cursor:pointer; background:${badgeBg}; padding:4px 8px; border-radius:8px; color: ${contrastColor};">
                    CIERRE: ${cycle.closingDay} ${monthName} | VTTO: ${cycle.dueDay} ${monthName} <i class="fa-solid fa-calendar-pen" style="margin-left:5px"></i>
                </div>
                <span style="color: ${contrastColor}; opacity: 0.8;">NICO DIAZ</span>
            </div>
        </div>
    `;
    renderPurchases();
    renderCardIndicators();

    if (hasMultipleCards) {
        initSwipeNavigation();
    }

    showView('card-details');
}

function renderCardIndicators() {
    const container = document.getElementById('card-indicators');
    if (!container) return;

    if (state.cards.length <= 1) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.cards.map(c => `
        <div class="indicator-dot ${c.id === state.selectedCardId ? 'active' : ''}"></div>
    `).join('');
}

let touchStartX = 0;
function initSwipeNavigation() {
    const target = document.getElementById('card-swipe-target');
    if (!target) return;

    target.ontouchstart = e => {
        touchStartX = e.changedTouches[0].screenX;
    };

    target.ontouchend = e => {
        const touchEndX = e.changedTouches[0].screenX;
        handleSwipe(touchStartX, touchEndX);
    };
}

function handleSwipe(start, end) {
    const threshold = 50;
    const diff = start - end;
    const currentIndex = state.cards.findIndex(c => c.id === state.selectedCardId);
    const target = document.getElementById('card-swipe-target');

    if (Math.abs(diff) > threshold && target) {
        if (diff > 0) {
            // Swipe Left -> Next Card
            const nextIdx = (currentIndex + 1) % state.cards.length;
            target.classList.add('animate-out-left');
            setTimeout(() => {
                viewCardDetails(state.cards[nextIdx].id, 'animate-in-right');
            }, 300);
        } else {
            // Swipe Right -> Prev Card
            const prevIdx = (currentIndex - 1 + state.cards.length) % state.cards.length;
            target.classList.add('animate-out-right');
            setTimeout(() => {
                viewCardDetails(state.cards[prevIdx].id, 'animate-in-left');
            }, 300);
        }
        if (navigator.vibrate) navigator.vibrate(20);
    }
}

function openBillingModal(card) {
    if (!card) card = state.cards.find(c => c.id === state.selectedCardId);
    if (!card) return;
    const ym = `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('billing-modal-date').innerText = ym;

    const billing = (card.billingCycles && card.billingCycles[ym]) || { closingDay: '', dueDay: '' };

    document.getElementById('billing-closing-day').value = billing.closingDay || '';
    document.getElementById('billing-due-day').value = billing.dueDay || '';

    // Initialize Carousel Pickers
    renderCarouselDayPicker('picker-billing-closing', 'billing-closing-day', billing.closingDay || 1);
    renderCarouselDayPicker('picker-billing-due', 'billing-due-day', billing.dueDay || 1);

    const form = document.getElementById('form-billing');
    form.onsubmit = function (e) {
        e.preventDefault();
        const closingDay = document.getElementById('billing-closing-day').value;
        const dueDay = document.getElementById('billing-due-day').value;

        if (!closingDay || !dueDay) return alert('Por favor selecciona ambas fechas.');

        if (!card.billingCycles) card.billingCycles = {};
        card.billingCycles[ym] = { closingDay: parseInt(closingDay), dueDay: parseInt(dueDay) };

        saveData();
        closeModal();
        viewCardDetails(card.id);
    };

    showModal('modal-billing', true);
}

function renderPurchases() {
    const list = document.getElementById('purchases-list');
    const y = state.currentDate.getFullYear();
    const m = state.currentDate.getMonth();
    const cardPurchases = state.purchases.filter(p => p.cardId === state.selectedCardId);

    list.innerHTML = cardPurchases.map(p => {
        const start = new Date(p.startMonth + '-02');
        const diff = (y - start.getFullYear()) * 12 + (m - start.getMonth());
        let status = '';
        let amt = parseFloat(p.amount);

        if (p.isRecurring) status = 'Recurrente';
        else {
            const cur = diff + 1;
            amt = amt / p.installments;
            if (diff < 0) status = `Inicia en ${p.startMonth}`;
            else if (cur > p.installments) status = 'Finalizado';
            else status = `Cuota ${cur}/${p.installments}`;
        }

        const iconClass = getCategoryIcon(p.name, p.icon);

        return `
            <div class="swipe-item-container">
                <div class="swipe-delete-action" onclick="deletePurchase('${p.id}')">
                    <i class="fa-solid fa-trash"></i>
                </div>
                <div class="expense-item swipe-item-content"
                     ontouchstart="handleItemTouchStart(event)" 
                     ontouchmove="handleItemTouchMove(event)" 
                     ontouchend="handleItemTouchEnd(event, '${p.id}', 'purchase')">
                    <div class="icon-box" style="background: rgba(129, 140, 248, 0.1); color: var(--secondary);">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <div class="expense-info">
                        <div class="expense-name">${sanitize(p.name)}</div>
                        <div class="expense-category">${status}</div>
                    </div>
                    <div class="expense-amount">$${amt.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
                    <button class="btn-action" onclick="editPurchase('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

// --- CRUD Actions ---
function editExpense(id) {
    const e = state.expenses.find(x => x.id === id);
    if (!e) return;
    document.getElementById('modal-fixed-title').innerText = 'Editar Gasto';
    document.getElementById('fixed-edit-id').value = id;
    document.getElementById('fixed-type').value = e.type;
    document.getElementById('fixed-name').value = e.name;
    document.getElementById('fixed-amount').value = e.amount;
    document.getElementById('fixed-icon').value = e.icon || '';
    renderIconPicker('icon-picker-fixed', 'fixed-icon', e.icon || '');
    initPicker('picker-fixed-month', e.month);
    const hasEnd = !!e.endMonth;
    document.getElementById('fixed-has-end').checked = hasEnd;
    document.getElementById('group-fixed-end').classList.toggle('hidden', !hasEnd);
    if (document.getElementById('group-fixed-end-wrap')) document.getElementById('group-fixed-end-wrap').style.display = (e.type === 'fixed') ? 'block' : 'none';
    initPicker('picker-fixed-end-month', e.endMonth || '');
    showModal('modal-fixed', true);
}

function deleteExpense(id) {
    if (confirm('¿Eliminar este gasto?')) {
        state.expenses = state.expenses.filter(x => x.id !== id);
        saveData();
        renderDashboard();
    }
}

function editCard(id) {
    const c = state.cards.find(x => x.id === id);
    if (!c) return;
    document.getElementById('modal-card-title').innerText = 'Editar Tarjeta';
    document.getElementById('card-edit-id').value = id;
    document.getElementById('card-bank').value = c.bank;
    document.getElementById('card-type').value = c.type;
    document.getElementById('card-last4').value = c.last4;
    document.getElementById('btn-delete-card').style.display = 'block';
    selectColor(c.color);
    showModal('modal-card', true);
}

function deleteCardFromModal() {
    const id = document.getElementById('card-edit-id').value;
    if (id && confirm('¿Eliminar esta tarjeta y todos sus movimientos?')) {
        state.cards = state.cards.filter(c => c.id !== id);
        state.purchases = state.purchases.filter(p => p.cardId !== id);
        saveData();
        closeModal();
        showView('cards');
    }
}

function editPurchase(id) {
    const p = state.purchases.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-purchase-title').innerText = 'Editar Consumo';
    document.getElementById('purchase-edit-id').value = id;
    document.getElementById('purchase-name').value = p.name;
    document.getElementById('purchase-amount').value = p.amount;
    document.getElementById('purchase-installments').value = p.installments;
    document.getElementById('purchase-icon').value = p.icon || '';
    renderIconPicker('icon-picker-purchase', 'purchase-icon', p.icon || '');
    initPicker('picker-purchase-start-month', p.startMonth);
    showModal('modal-purchase', true);
}

function deletePurchase(id) {
    if (confirm('¿Eliminar este consumo?')) {
        state.purchases = state.purchases.filter(p => p.id !== id);
        saveData();
        renderPurchases();
        renderDashboard();
    }
}

// --- Forms ---
document.getElementById('form-fixed').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('fixed-edit-id').value;
    const type = document.getElementById('fixed-type').value;
    const hasEnd = type === 'fixed' && document.getElementById('fixed-has-end').checked;
    const data = {
        name: document.getElementById('fixed-name').value,
        amount: document.getElementById('fixed-amount').value,
        type: type,
        icon: document.getElementById('fixed-icon').value,
        month: document.getElementById('fixed-month').value,
        endMonth: hasEnd ? document.getElementById('fixed-end-month').value : null
    };
    if (id) {
        const i = state.expenses.findIndex(x => x.id === id);
        state.expenses[i] = { ...state.expenses[i], ...data };
    } else {
        state.expenses.push({ id: Date.now().toString(), ...data });
    }
    saveData(); closeModal(); renderDashboard();
};

document.getElementById('form-card').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('card-edit-id').value;
    const data = {
        bank: document.getElementById('card-bank').value,
        type: document.getElementById('card-type').value,
        last4: document.getElementById('card-last4').value,
        color: document.getElementById('card-color').value
    };
    if (id) {
        const i = state.cards.findIndex(x => x.id === id);
        state.cards[i] = { ...state.cards[i], ...data };
    } else {
        state.cards.push({ id: Date.now().toString(), ...data, billingCycles: {} });
    }
    saveData(); closeModal(); renderViewAfterCardUpdate(id);
};

function renderViewAfterCardUpdate(id) {
    if (state.currentView === 'card-details' && state.selectedCardId === id) {
        viewCardDetails(id);
    } else {
        showView('cards');
    }
}

document.getElementById('form-billing').onsubmit = (e) => {
    e.preventDefault();
    const card = state.cards.find(c => c.id === state.selectedCardId);
    const ym = `${state.currentDate.getFullYear()}-${String(state.currentDate.getMonth() + 1).padStart(2, '0')}`;
    card.billingCycles[ym] = {
        closingDay: document.getElementById('billing-closing-day').value,
        dueDay: document.getElementById('billing-due-day').value
    };
    saveData(); closeModal(); viewCardDetails(state.selectedCardId);
};

document.getElementById('form-purchase').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('purchase-edit-id').value;
    const data = {
        cardId: state.selectedCardId,
        name: document.getElementById('purchase-name').value,
        amount: parseFloat(document.getElementById('purchase-amount').value),
        isRecurring: false,
        installments: parseInt(document.getElementById('purchase-installments').value) || 1,
        icon: document.getElementById('purchase-icon').value,
        startMonth: document.getElementById('purchase-start-month').value
    };
    if (id) {
        const i = state.purchases.findIndex(x => x.id === id);
        state.purchases[i] = { ...state.purchases[i], ...data };
    } else {
        state.purchases.push({ id: Date.now().toString(), ...data });
    }
    saveData(); closeModal(); renderPurchases(); renderDashboard();
};

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert("Tu navegador no soporta notificaciones.");
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            state.notificationsEnabled = true;
            saveData();
            showView('settings'); // Refrescar botón
            new Notification("¡Genial!", {
                body: "Ahora recibirás alertas de tus tarjetas.",
                icon: "./icon.png"
            });
        }
    });
}

function toggleNotifications() {
    state.notificationsEnabled = !state.notificationsEnabled;
    saveData();
    showView('settings'); // Refrescar botón
    const msg = state.notificationsEnabled ? "Notificaciones activadas" : "Notificaciones desactivadas";
    alert(msg);
}

function showLocalNotification(title, body) {
    const todayStr = new Date().toISOString().split('T')[0];
    const notifKey = `${todayStr}_${title}_${body}`;

    // Si ya notificamos esto hoy en esta sesión, no repetir
    if (notifiedToday.has(notifKey)) return;

    if (Notification.permission === 'granted' && state.notificationsEnabled) {
        const options = {
            body: body,
            icon: "./icon.png",
            vibrate: [200, 100, 200],
            badge: "./icon.png",
            tag: notifKey // Unifica avisos iguales
        };

        notifiedToday.add(notifKey);

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, options);
            });
        } else {
            new Notification(title, options);
        }
    }
}

function forceSync() {
    const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
    if (userSession.id && userSession.id !== 'local') {
        syncDataToCloud();
    } else {
        alert("Inicia sesión con Google para sincronizar.");
    }
}

init();
