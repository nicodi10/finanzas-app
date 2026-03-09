// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyCZIVq0dkwHKX9v00fusxCvkyZQFfXjHbw",
    authDomain: "finanzas-app-14a70.firebaseapp.com",
    projectId: "finanzas-app-14a70",
    storageBucket: "finanzas-app-14a70.firebasestorage.app",
    messagingSenderId: "137607555145",
    appId: "1:137607555145:web:74554f6a2fd0c5defcb798"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Enable offline persistence
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn("Múltiples pestañas abiertas, persistencia solo funciona en una.");
        } else if (err.code == 'unimplemented') {
            console.warn("El navegador no soporta persistencia offline.");
        }
    });

// --- State Management ---
let state = {
    currentView: 'dashboard',
    currentDate: new Date(),
    expenses: [], // {id, type: 'fixed'|'variable', name, amount, month: 'YYYY-MM', endMonth: 'YYYY-MM'|null}
    cards: [],    // {id, bank, type, last4, color, billingCycles: { 'YYYY-MM': {closingDay, dueDay} }}
    purchases: [], // {id, cardId, name, amount, isRecurring, installments, startMonth}
    selectedCardId: null,
    unsubscribeSync: null
};

const COLOR_PALETTE = ['#38bdf8', '#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#f87171', '#94a3b8', '#1e293b'];

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
    const userSession = localStorage.getItem('ff_user_session');
    if (userSession) {
        document.getElementById('view-login').style.display = 'none';
        document.getElementById('main-app-container').classList.remove('hidden');

        // Se carga primero lo local para rapidez, luego se sincroniza con la nube
        loadData();

        // Intentar sesión en Firebase si hay sesión guardada
        const session = JSON.parse(userSession);
        if (session.id !== 'guest') {
            console.log("Iniciando sincronización con la nube...");
        }
    } else {
        document.getElementById('view-login').style.display = 'flex';
        document.getElementById('main-app-container').classList.add('hidden');
    }

    // Listener para autocompletar color de banco y actualizar la esfera dinámica
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

function handleCredentialResponse(response) {
    // Decodificación segura de JWT para manejar caracteres UTF-8 (como tildes)
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const responsePayload = JSON.parse(jsonPayload);
    const userData = {
        id: responsePayload.sub,
        name: responsePayload.name,
        email: responsePayload.email
    };

    localStorage.setItem('ff_user_session', JSON.stringify(userData));

    // Auth con Firebase usando el token de Google
    const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    auth.signInWithCredential(credential).then(() => {
        console.log("Conectado a la nube exitosamente");
        startCloudSyncListener();
    }).catch(err => {
        console.error("Error al conectar con la nube:", err);
    });

    document.getElementById('view-login').style.display = 'none';
    document.getElementById('main-app-container').classList.remove('hidden');
    loadData();
}

function guestLogin() {
    let userName = prompt("¿Cuál es tu nombre?", "Invitado");
    if (!userName || userName.trim() === '') userName = "Invitado";

    localStorage.setItem('ff_user_session', JSON.stringify({
        id: 'guest',
        name: userName.trim(),
        email: 'local@device'
    }));
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('main-app-container').classList.remove('hidden');
    loadData();
}

function loadData() {
    const savedState = localStorage.getItem('finanzas_data_v3');
    if (savedState) {
        // Prevent local data from overwriting cloud data if cloud sync has already populated state
        if (!state.expenses.length && !state.cards.length && !state.purchases.length) {
            state = { ...state, ...JSON.parse(savedState) };
            state.currentDate = new Date();
        }
    }
    renderColorPicker();
    renderDashboard();
}

function logout() {
    localStorage.removeItem('ff_user_session');
    location.reload();
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

function updateSyncStatus(status) {
    const icon = document.getElementById('sync-icon');
    const text = document.getElementById('sync-text');
    if (!icon || !text) return;

    if (status === 'syncing') {
        icon.className = 'fa-solid fa-arrows-rotate fa-spin';
        text.innerText = 'Sincronizando...';
        icon.style.color = 'var(--primary)';
    } else if (status === 'synced') {
        icon.className = 'fa-solid fa-cloud-check';
        text.innerText = 'Nube actualizada';
        icon.style.color = 'var(--success)';
    } else if (status === 'local') {
        icon.className = 'fa-solid fa-cloud-slash';
        text.innerText = 'Modo Local';
        icon.style.color = 'var(--text-secondary)';
    } else if (status === 'error') {
        icon.className = 'fa-solid fa-cloud-exclamation';
        text.innerText = 'Error de conexión';
        icon.style.color = 'var(--danger)';
    }
}

// Modificar saveData para usar el status
function saveData() {
    const data = {
        expenses: state.expenses,
        cards: state.cards,
        purchases: state.purchases
    };
    localStorage.setItem('finanzas_data_v3', JSON.stringify(data));

    // Sincronizar con Firebase si el usuario está logueado
    if (auth.currentUser) {
        updateSyncStatus('syncing');
        db.collection('users').doc(auth.currentUser.uid).set(data)
            .then(() => {
                console.log("Nube actualizada ✅");
                updateSyncStatus('synced');
            })
            .catch(err => {
                console.error("Error al guardar en la nube:", err);
                updateSyncStatus('error');
            });
    } else {
        updateSyncStatus('local');
    }
}

function startCloudSyncListener() {
    if (!auth.currentUser) return;

    // Si ya hay un listener activo, no crear otro
    if (state.unsubscribeSync) return;

    updateSyncStatus('syncing');

    state.unsubscribeSync = db.collection('users').doc(auth.currentUser.uid)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const cloudData = doc.data();

                // Solo actualizamos si los datos son diferentes para evitar re-renderizados infinitos
                console.log("Datos recibidos de la nube ☁️");

                // Actualizamos estado local
                state.expenses = cloudData.expenses || [];
                state.cards = cloudData.cards || [];
                state.purchases = cloudData.purchases || [];

                // Guardamos en localStorage para persistencia offline
                localStorage.setItem('finanzas_data_v3', JSON.stringify({
                    expenses: state.expenses,
                    cards: state.cards,
                    purchases: state.purchases
                }));

                renderDashboard();
                updateSyncStatus('synced');
            } else {
                // Si el doc no existe, subimos lo local por primera vez SOLO si hay datos locales
                if (state.expenses.length > 0 || state.cards.length > 0 || state.purchases.length > 0) {
                    saveData();
                } else {
                    updateSyncStatus('synced'); // No hay nada local ni en nube, está sincronizado (vacío)
                }
            }
        }, (err) => {
            console.error("Error en el listener de la nube:", err);
            updateSyncStatus('error');
        });
}

function stopCloudSyncListener() {
    if (state.unsubscribeSync) {
        state.unsubscribeSync();
        state.unsubscribeSync = null;
        updateSyncStatus('local');
    }
}

// Escuchar cambios en auth de Firebase
auth.onAuthStateChanged(user => {
    if (user) {
        startCloudSyncListener();
    } else {
        stopCloudSyncListener();
        const userSession = localStorage.getItem('ff_user_session');
        if (userSession) {
            try {
                const session = JSON.parse(userSession);
                if (session.id !== 'guest') {
                    console.warn("La sesión de Firebase expiró o el equipo está offline.");
                    updateSyncStatus('error');
                }
            } catch (e) { }
        }
    }
});

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
function showView(viewId) {
    if (viewId === 'dashboard') {
        state.currentDate = new Date(); // Reinicia al mes actual verdadero
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
        if (nameEl) nameEl.innerText = userSession.name || 'Invitado';
        if (emailEl) emailEl.innerText = userSession.email || 'Local';
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
            initPicker('picker-fixed-month', ym);
            initPicker('picker-fixed-end-month', '');
            document.getElementById('fixed-has-end').checked = false;
            document.getElementById('group-fixed-end').classList.add('hidden');
        } else if (modalId === 'modal-card') {
            document.getElementById('modal-card-title').innerText = 'Nueva Tarjeta';
            document.getElementById('card-edit-id').value = '';
            document.getElementById('btn-delete-card').style.display = 'none';
            selectColor('#38bdf8');
        } else if (modalId === 'modal-purchase') {
            document.getElementById('modal-purchase-title').innerText = 'Nueva Cuota';
            document.getElementById('purchase-edit-id').value = '';
            toggleInstallments(false);
            initPicker('picker-purchase-start-month', ym);
        }
    }
    document.getElementById(modalId).classList.add('active');
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
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

// --- Rendering ---
function renderDashboard() {
    const { fixedTotal, cardTotal, cardSummary, filteredExpenses } = getMonthlyStats();

    const userSession = JSON.parse(localStorage.getItem('ff_user_session') || '{}');
    const greetingTitle = document.getElementById('dashboard-greeting-title');
    if (greetingTitle && userSession.name) {
        const firstName = userSession.name.split(' ')[0];
        greetingTitle.innerText = `Hola, ${sanitize(firstName)}! 👋`;
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

            return `
                <div class="expense-item glass">
                    <div class="icon-box" style="background: ${e.type === 'fixed' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(129, 140, 248, 0.1)'}; color: ${e.type === 'fixed' ? 'var(--primary)' : 'var(--secondary)'};">
                        <i class="fa-solid ${e.type === 'fixed' ? 'fa-house-lock' : 'fa-calendar-day'}"></i>
                    </div>
                    <div class="expense-info">
                        <div class="expense-name">${sanitize(e.name)}${installmentText}</div>
                        <div class="expense-category">${e.type === 'fixed' ? 'Gasto Fijo' : 'Gasto del Mes'} ${e.endMonth === (state.currentDate.getFullYear() + '-' + String(state.currentDate.getMonth() + 1).padStart(2, '0')) ? '⚠️ Finaliza' : ''}</div>
                    </div>
                    <div class="expense-amount">$${parseFloat(e.amount).toLocaleString('es-AR')}</div>
                    <button class="btn-action" onclick="editExpense('${e.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-action delete" onclick="deleteExpense('${e.id}')"><i class="fa-solid fa-trash"></i></button>
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
            return `
                <div class="expense-item glass" onclick="viewCardDetails('${c.id}')">
                    <div class="icon-box" style="background: ${c.color}22; color: ${c.color}; font-size: 1.8rem;">${getCardLogo(c.type)}</div>
                    <div class="expense-info">
                        <div class="expense-name">${sanitize(c.bank)}</div>
                        <div class="expense-category">Vto: ${cycle.dueDay} | Total: $${(cardSummary[c.id] || 0).toLocaleString('es-AR')}</div>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="opacity: 0.3;"></i>
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

    hero.innerHTML = `
        <div class="card-preview ${animationClass || ''}" id="card-swipe-target" style="background: linear-gradient(135deg, ${card.color}EE, #1e293b);">
            <div class="card-logo-overlay" onclick="editCard('${card.id}')" style="cursor:pointer">${getCardLogo(card.type)}</div>
            <div class="card-bank">${sanitize(card.bank)}</div>
            <div class="card-chip"></div>
            <div class="card-number-display">**** **** **** ${sanitize(card.last4)}</div>
            <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 600; margin-top: 10px;">
                <div onclick="openBillingModal()" style="cursor:pointer; background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:8px;">
                    CIERRE: ${cycle.closingDay} ${monthName} | VTTO: ${cycle.dueDay} ${monthName} <i class="fa-solid fa-calendar-pen" style="margin-left:5px"></i>
                </div>
                <span>NICO DIAZ</span>
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

        return `
            <div class="expense-item glass">
                <div class="expense-info">
                    <div class="expense-name">${sanitize(p.name)}</div>
                    <div class="expense-category">${status}</div>
                </div>
                <div class="expense-amount">$${amt.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
                <button class="btn-action" onclick="editPurchase('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-action delete" onclick="deletePurchase('${p.id}')"><i class="fa-solid fa-trash"></i></button>
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
    document.getElementById('fixed-amount').value = e.amount;
    initPicker('picker-fixed-month', e.month);
    const hasEnd = !!e.endMonth;
    document.getElementById('fixed-has-end').checked = hasEnd;
    document.getElementById('group-fixed-end').classList.toggle('hidden', !hasEnd);
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
    document.getElementById('purchase-recurring').checked = p.isRecurring;
    document.getElementById('purchase-installments').value = p.installments;
    initPicker('picker-purchase-start-month', p.startMonth);
    toggleInstallments(p.isRecurring);
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
    const hasEnd = document.getElementById('fixed-has-end').checked;
    const data = {
        name: document.getElementById('fixed-name').value,
        amount: document.getElementById('fixed-amount').value,
        type: document.getElementById('fixed-type').value,
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
    const isRec = document.getElementById('purchase-recurring').checked;
    const data = {
        cardId: state.selectedCardId,
        name: document.getElementById('purchase-name').value,
        amount: parseFloat(document.getElementById('purchase-amount').value),
        isRecurring: isRec,
        installments: isRec ? 0 : parseInt(document.getElementById('purchase-installments').value),
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

init();
