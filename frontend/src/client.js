import { api } from './api.js';
import { Scene3DManager } from './scene3d.js';
import {
    LoadSceneParameters, NewRISParameters, EditRISParameters,
    DeleteObjectParameters, ConfigurePlanarArraysParameters, NewRadioObjectParameters,
    EditRadioObjectParameters, Vector, RISMode, RadioObjectType,
    RayTracingParameters, CoverageMapParameters, SaveSessionParameters,
    LoadSessionParameters, LookAtMode
} from './grpc/ris_pb.js';

let currentSessionId = null;
let sceneManager = null;
let planarArrayTxConfigured = false;
let planarArrayRxConfigured = false;

// Helpers para UI
const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
const getCheckedVal = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

// Inicialización
async function startApp() {
    try {
        const response = await api.initializeSession();
        currentSessionId = response.getSessionId();
        console.log("Session initialized successfully. ID:", currentSessionId);
        sceneManager = new Scene3DManager('contenedor-3d', () => currentSessionId);
        bindUIEvents();
    } catch (err) {
        console.error("An error occurred while connecting to the gRPC backend:", err);
        alert("Unable to connect to the server.");
    }
}

function updateLookAtDropdowns(isRis = false, currentRisId = null) {
    const radioObjects = sceneManager.getObjects();
    const addSelectId = isRis ? 'ris-lookat-obj-select' : 'radio-lookat-obj-select';
    const editSelectId = isRis ? 'edit-ris-lookat-obj-select' : 'edit-radio-lookat-obj-select';

    const addSelect = document.getElementById(addSelectId);
    const editSelect = document.getElementById(editSelectId);

    if (addSelect) addSelect.innerHTML = '<option value="">None</option>';
    if (editSelect) editSelect.innerHTML = '<option value="">None</option>';

    radioObjects.forEach(mesh => {
        const optionHtml = `<option value="${mesh.name}">${mesh.name} (${mesh.userData.sionnaParameters.type})</option>`;
        if (addSelect) addSelect.innerHTML += optionHtml;
        if (editSelect && mesh.name !== currentRisId) editSelect.innerHTML += optionHtml;
    });
}

function renderModeInputs(containerId, numModes, existingSources = [], existingTargets = []) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const objects = sceneManager.getObjects();
    const transmitters = objects.filter(m => m.userData.sionnaParameters.type === "transmitter");
    const receivers = objects.filter(m => m.userData.sionnaParameters.type === "receiver");

    for (let i = 0; i < numModes; i++) {
        let txOptions = '<option value="">None</option>' + transmitters.map(m =>
            `<option value="${m.name}" ${m.name === (existingSources[i] || '') ? 'selected' : ''}>${m.name}</option>`
        ).join('');

        let rxOptions = '<option value="">None</option>' + receivers.map(m =>
            `<option value="${m.name}" ${m.name === (existingTargets[i] || '') ? 'selected' : ''}>${m.name}</option>`
        ).join('');

        const rowHtml = `
            <div class="row mb-2 align-items-center mode-row border-bottom pb-1" data-mode-index="${i}">
                <div class="col-12 text-muted fw-bold mb-1" style="font-size: 0.8rem;">Mode ${i + 1}</div>
                <div class="col-6"><label class="form-label small mb-1">Source TX</label><select class="form-select form-select-sm mode-source-select">${txOptions}</select></div>
                <div class="col-6"><label class="form-label small mb-1">Target RX</label><select class="form-select form-select-sm mode-target-select">${rxOptions}</select></div>
            </div>`;
        container.insertAdjacentHTML('beforeend', rowHtml);
    }
}

const validateSimulationPrerequisites = () => {
    const objects = sceneManager.getObjects();
    const hasTransmitter = objects.some(m => m.userData.sionnaParameters.type === "transmitter");
    const hasReceiver = objects.some(m => m.userData.sionnaParameters.type === "receiver");

    if (!hasTransmitter || !hasReceiver) {
        alert("Simulation failed: At least one transmitter and one receiver are needed.");
        return false;
    }
    if (!planarArrayTxConfigured || !planarArrayRxConfigured) {
        alert("Simulation failed: Planar arrays must be configured.");
        return false;
    }
    return true;
};

const isInvalidNum = (val) => val === '' || val === null || val === undefined || isNaN(val);

function bindUIEvents() {
    // Toggles y visibilidad UI
    const setupToggles = (radioName, idsMap) => {
        document.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                for (const [key, id] of Object.entries(idsMap)) {
                    document.getElementById(id).classList.toggle('d-none', e.target.value !== key);
                }
            });
        });
    };

    setupToggles("risSizeMode", { width: 'ris-size-width-inputs', rowscols: 'ris-size-rowscols-inputs' });
    setupToggles("editRisSizeMode", { width: 'edit-ris-size-width-inputs', rowscols: 'edit-ris-size-rowscols-inputs' });
    setupToggles("radioLookAtMode", { orientation: 'radio-orientation-inputs', position: 'radio-lookat-pos-inputs', object: 'radio-lookat-obj-inputs' });
    setupToggles("editRadioLookAtMode", { orientation: 'edit-radio-orientation-inputs', position: 'edit-radio-lookat-pos-inputs', object: 'edit-radio-lookat-obj-inputs' });
    setupToggles("risLookAtMode", { orientation: 'ris-orientation-inputs', position: 'ris-lookat-pos-inputs', object: 'ris-lookat-obj-inputs' });
    setupToggles("editRisLookAtMode", { orientation: 'edit-ris-orientation-inputs', position: 'edit-ris-lookat-pos-inputs', object: 'edit-ris-lookat-obj-inputs' });

    const updateProfileVis = (modeId, configId, numModesId, containerId) => {
        const mode = document.getElementById(modeId).value;
        document.getElementById(configId).classList.toggle('d-none', mode === 'NONE');
        if (mode !== 'NONE') {
            renderModeInputs(containerId, parseInt(document.getElementById(numModesId).value) || 1);
        }
    };

    ['ris', 'edit-ris'].forEach(prefix => {
        document.getElementById(`${prefix}-mode`).addEventListener('change', () => updateProfileVis(`${prefix}-mode`, `${prefix}-profile-config`, `${prefix}-num-modes`, `${prefix}-modes-container`));
        document.getElementById(`${prefix}-num-modes`).addEventListener('input', () => updateProfileVis(`${prefix}-mode`, `${prefix}-profile-config`, `${prefix}-num-modes`, `${prefix}-modes-container`));
    });

    document.getElementById('modal-add-ris').addEventListener('show.bs.modal', () => { updateLookAtDropdowns(true); updateProfileVis('ris-mode', 'ris-profile-config', 'ris-num-modes', 'ris-modes-container'); });
    document.getElementById('modal-edit-ris').addEventListener('show.bs.modal', () => updateProfileVis('edit-ris-mode', 'edit-ris-profile-config', 'edit-ris-num-modes', 'edit-ris-modes-container'));
    document.getElementById('modal-add-radio').addEventListener('show.bs.modal', () => updateLookAtDropdowns(false));
    document.getElementById('modal-edit-radio').addEventListener('show.bs.modal', () => updateLookAtDropdowns(false));

    // Funciones del menú flotante
    const hoverMenu = document.getElementById('ris-hover-menu');
    document.getElementById('btn-hover-delete').addEventListener('click', async () => {
        const selected = sceneManager.getSelectedObject();
        if (!selected) return;

        const request = new DeleteObjectParameters();
        request.setSessionId(currentSessionId);
        request.setName(selected.name);

        try {
            await api.deleteObject(request);
            sceneManager.removeSelectedObject();
            hoverMenu.classList.add('d-none');
        } catch (err) {
            console.error(err);
        }
    });

    document.getElementById('btn-hover-edit').addEventListener('click', () => {
        const mesh = sceneManager.getSelectedObject();
        if (!mesh) return;
        const data = mesh.userData.sionnaParameters;

        if (data.type === "RIS") {
            updateLookAtDropdowns(true, mesh.name);
            document.getElementById('edit-ris-oldname').value = mesh.name;
            document.getElementById('edit-ris-name').value = mesh.name;
            document.getElementById('edit-ris-pos-x').value = mesh.position.x.toFixed(1);
            document.getElementById('edit-ris-pos-y').value = -mesh.position.z.toFixed(1);
            document.getElementById('edit-ris-pos-z').value = mesh.position.y.toFixed(1);
            document.getElementById('edit-ris-ori-x').value = data.oriX || 0;
            document.getElementById('edit-ris-ori-y').value = data.oriY || 0;
            document.getElementById('edit-ris-ori-z').value = data.oriZ || 0;
            document.getElementById('edit-ris-lookat-pos-x').value = data.lookAtPosX || 0;
            document.getElementById('edit-ris-lookat-pos-y').value = data.lookAtPosY || 0;
            document.getElementById('edit-ris-lookat-pos-z').value = data.lookAtPosZ || 0;
            document.getElementById('edit-ris-lookat-obj-select').value = data.lookAtName || "";
            document.getElementById('edit-ris-mode').value = data.mode;
            document.getElementById('edit-ris-num-modes').value = data.numModes || 1;

            const mType = data.lookAtMode || 'orientation';
            document.querySelector(`input[name="editRisLookAtMode"][value="${mType}"]`).checked = true;
            document.querySelector(`input[name="editRisLookAtMode"][value="${mType}"]`).dispatchEvent(new Event('change'));

            if (data.mode !== 'NONE') renderModeInputs('edit-ris-modes-container', data.numModes, data.profileConfig.srcTransmitterNames, data.profileConfig.tarReceiverNames);
            new bootstrap.Modal(document.getElementById('modal-edit-ris')).show();

        } else {
            updateLookAtDropdowns(false);
            document.getElementById('edit-radio-oldname').value = mesh.name;
            document.getElementById('edit-radio-type').value = data.type;
            document.getElementById('edit-radio-name').value = mesh.name;
            document.getElementById('edit-radio-pos-x').value = mesh.position.x.toFixed(1);
            document.getElementById('edit-radio-pos-y').value = -mesh.position.z.toFixed(1);
            document.getElementById('edit-radio-pos-z').value = mesh.position.y.toFixed(1);
            document.getElementById('edit-radio-ori-x').value = data.oriX || 0;
            document.getElementById('edit-radio-ori-y').value = data.oriY || 0;
            document.getElementById('edit-radio-ori-z').value = data.oriZ || 0;
            document.getElementById('edit-radio-lookat-pos-x').value = data.lookAtPosX || 0;
            document.getElementById('edit-radio-lookat-pos-y').value = data.lookAtPosY || 0;
            document.getElementById('edit-radio-lookat-pos-z').value = data.lookAtPosZ || 0;
            document.getElementById('edit-radio-lookat-obj-select').value = data.lookAtName || "";

            const mType = data.lookAtMode || 'orientation';
            document.querySelector(`input[name="editRadioLookAtMode"][value="${mType}"]`).checked = true;
            document.querySelector(`input[name="editRadioLookAtMode"][value="${mType}"]`).dispatchEvent(new Event('change'));
            new bootstrap.Modal(document.getElementById('modal-edit-radio')).show();
        }
        hoverMenu.classList.add('d-none');
    });

    // Envío de formularios
    document.getElementById('form-add-ris').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('ris-name').value;

        // 1. Validación de nombre obligatorio y duplicado
        if (!name || !name.trim()) {
            alert(`RIS creation failed: Name is required.`);
            return;
        }

        const objects = sceneManager.getObjects();
        if (objects.some(obj => obj.name === name)) {
            alert(`RIS creation failed: The name "${name}" is already used.`);
            return;
        }

        // 2. Validación de Tamaño (Ancho vs Filas/Columnas)
        const sizeMode = getCheckedVal('risSizeMode');
        let w = 0, nr = 0, nc = 0;

        if (sizeMode === 'width') {
            w = getVal('ris-width');
            if (isInvalidNum(w) || w <= 0) {
                alert(`RIS creation failed: Width must be a positive number.`);
                return;
            }
        } else {
            nr = getVal('ris-rows');
            nc = getVal('ris-cols');
            if (isInvalidNum(nr) || isInvalidNum(nc) || nr <= 2 || nc <= 2) {
                alert(`RIS creation failed: Rows and columns must be three minimum.`);
                return;
            }
        }

        // 3. Validación de Posición (permite 0)
        const posX = getVal('ris-pos-x');
        const posY = getVal('ris-pos-y');
        const posZ = getVal('ris-pos-z');

        if (isInvalidNum(posX) || isInvalidNum(posY) || isInvalidNum(posZ)) {
            alert(`RIS creation failed: Position coordinates are missing.`);
            return;
        }

        // 4. Validación según LookAt / Orientación
        const lMode = getCheckedVal('risLookAtMode');
        const lName = document.getElementById('ris-lookat-obj-select').value;
        let oriX = 0, oriY = 0, oriZ = 0;
        let lPosX = 0, lPosY = 0, lPosZ = 0;

        if (lMode === "orientation") {
            oriX = getVal('ris-ori-x');
            oriY = getVal('ris-ori-y');
            oriZ = getVal('ris-ori-z');
            if (isInvalidNum(oriX) || isInvalidNum(oriY) || isInvalidNum(oriZ)) {
                alert(`RIS creation failed: Orientation angles are missing.`);
                return;
            }
        } else if (lMode === "position") {
            lPosX = getVal('ris-lookat-pos-x');
            lPosY = getVal('ris-lookat-pos-y');
            lPosZ = getVal('ris-lookat-pos-z');
            if (isInvalidNum(lPosX) || isInvalidNum(lPosY) || isInvalidNum(lPosZ)) {
                alert(`RIS creation failed: LookAt position coordinates are missing.`);
                return;
            }
        } else if (lMode === "object") {
            if (!lName) {
                alert(`RIS creation failed: Target object is missing.`);
                return;
            }
        }

        // 5. Validación de Modos RIS
        const mode = document.getElementById('ris-mode').value;
        const numModes = getVal('ris-num-modes') || 1;
        let srcs = [], tars = [];

        if (mode !== "NONE") {
            if (isInvalidNum(numModes) || numModes < 1) {
                alert(`RIS creation failed: Number of modes must be at least 1.`);
                return;
            }

            document.querySelectorAll('#ris-modes-container .mode-row').forEach(row => {
                srcs.push(row.querySelector('.mode-source-select').value);
                tars.push(row.querySelector('.mode-target-select').value);
            });

            if (srcs.length === 0 || srcs.some(s => !s) || tars.some(t => !t)) {
                alert(`RIS creation failed: All source and target modes must be selected.`);
                return;
            }
        }

        const params = new NewRISParameters();
        params.setSessionId(currentSessionId);
        params.setName(name);
        params.setWidth(w);
        params.setNumrows(nr);
        params.setNumcols(nc);

        const pos = new Vector();
        pos.setX(posX); pos.setY(posY); pos.setZ(posZ);
        params.setPosition(pos);

        const ori = new Vector();
        const lPos = new Vector();

        if (lMode === "orientation") {
            params.setLookAtMode(LookAtMode.MODE_ORIENTATION);
            ori.setX(oriX); ori.setY(oriY); ori.setZ(oriZ);
        } else if (lMode === "position") {
            params.setLookAtMode(LookAtMode.MODE_POSITION);
            lPos.setX(lPosX); lPos.setY(lPosY); lPos.setZ(lPosZ);
        } else {
            params.setLookAtMode(LookAtMode.MODE_OBJECT);
            params.setLookAtName(lName);
        }
        params.setOrientation(ori);
        params.setLookAtPosition(lPos);

        params.setMode(mode === "NONE" ? RISMode.NONE : (mode === "PHASE_GRADIENT" ? RISMode.PHASE_GRADIENT : RISMode.FOCUSING_LENS));
        params.setNumModes(numModes);
        params.setSourceNamesList(srcs);
        params.setTargetNamesList(tars);

        try {
            await api.createRIS(params);
            sceneManager.drawRIS(name, w, nr, nc, posX, posY, posZ, oriX, oriY, oriZ, mode, numModes, srcs, tars, lMode, lPosX, lPosY, lPosZ, lName);
            bootstrap.Modal.getInstance(document.getElementById('modal-add-ris')).hide();
            e.target.reset();
        } catch (err) {
            alert("Server error");
        }
    });

    document.getElementById('form-edit-ris').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const oldName = document.getElementById('edit-ris-oldname').value;
        const newName = document.getElementById('edit-ris-name').value;

        // 1. Validación de nombre
        if (!newName || !newName.trim()) {
            alert(`Edit RIS failed: Name is required.`);
            return;
        }

        if (oldName !== newName) {
            const objects = sceneManager.getObjects();
            if (objects.some(obj => obj.name === newName)) {
                alert(`Edit RIS failed: The name "${newName}" is already used.`);
                return;
            }
        }

        // 2. Validación de tamaño
        const sizeMode = getCheckedVal('editRisSizeMode');
        let w = 0, nr = 0, nc = 0;
        
        if (sizeMode === 'width') {
            w = getVal('edit-ris-width');
            if (isInvalidNum(w) || w <= 0) {
                alert(`Edit RIS failed: Width must be a positive number.`);
                return;
            }
        } else {
            nr = getVal('edit-ris-rows');
            nc = getVal('edit-ris-cols');
            if (isInvalidNum(nr) || isInvalidNum(nc) || nr <= 0 || nc <= 0) {
                alert(`Edit RIS failed: Rows and columns must be positive numbers.`);
                return;
            }
        }

        // 3. Validación de posición
        const posX = getVal('edit-ris-pos-x');
        const posY = getVal('edit-ris-pos-y');
        const posZ = getVal('edit-ris-pos-z');
        if (isInvalidNum(posX) || isInvalidNum(posY) || isInvalidNum(posZ)) {
            alert(`Edit RIS failed: Position coordinates are missing.`);
            return;
        }

        // 4. Validación de LookAt / Orientación
        const lMode = getCheckedVal('editRisLookAtMode');
        const lName = document.getElementById('edit-ris-lookat-obj-select').value;
        let oriX = 0, oriY = 0, oriZ = 0;
        let lPosX = 0, lPosY = 0, lPosZ = 0;

        if (lMode === "orientation") {
            oriX = getVal('edit-ris-ori-x'); oriY = getVal('edit-ris-ori-y'); oriZ = getVal('edit-ris-ori-z');
            if (isInvalidNum(oriX) || isInvalidNum(oriY) || isInvalidNum(oriZ)) {
                alert(`Edit RIS failed: Orientation angles are missing.`);
                return;
            }
        } else if (lMode === "position") {
            lPosX = getVal('edit-ris-lookat-pos-x'); lPosY = getVal('edit-ris-lookat-pos-y'); lPosZ = getVal('edit-ris-lookat-pos-z');
            if (isInvalidNum(lPosX) || isInvalidNum(lPosY) || isInvalidNum(lPosZ)) {
                alert(`Edit RIS failed: LookAt position coordinates are missing.`);
                return;
            }
        } else if (lMode === "object" && !lName) {
            alert(`Edit RIS failed: Target object is missing.`);
            return;
        }

        // 5. Validación de Modos
        const mode = document.getElementById('edit-ris-mode').value;
        const numModes = getVal('edit-ris-num-modes') || 1;
        let srcs = [], tars = [];

        if (mode !== "NONE") {
            if (isInvalidNum(numModes) || numModes < 1) {
                alert(`Edit RIS failed: Number of modes must be at least 1.`);
                return;
            }
            document.querySelectorAll('#edit-ris-modes-container .mode-row').forEach(row => {
                srcs.push(row.querySelector('.mode-source-select').value);
                tars.push(row.querySelector('.mode-target-select').value);
            });
            if (srcs.length === 0 || srcs.some(s => !s) || tars.some(t => !t)) {
                alert(`Edit RIS failed: All source and target modes must be selected.`);
                return;
            }
        }

        const params = new EditRISParameters();
        params.setSessionId(currentSessionId); 
        params.setOldname(oldName); 
        params.setNewname(newName);
        params.setWidth(w); params.setNumrows(nr); params.setNumcols(nc);

        const pos = new Vector(); pos.setX(posX); pos.setY(posY); pos.setZ(posZ);
        params.setPosition(pos);

        const ori = new Vector(); const lPos = new Vector();
        if (lMode === "orientation") {
            params.setLookAtMode(LookAtMode.MODE_ORIENTATION);
            ori.setX(oriX); ori.setY(oriY); ori.setZ(oriZ);
        } else if (lMode === "position") {
            params.setLookAtMode(LookAtMode.MODE_POSITION);
            lPos.setX(lPosX); lPos.setY(lPosY); lPos.setZ(lPosZ);
        } else {
            params.setLookAtMode(LookAtMode.MODE_OBJECT);
            params.setLookAtName(lName);
        }
        params.setOrientation(ori); params.setLookAtPosition(lPos);

        params.setMode(mode === "NONE" ? RISMode.NONE : (mode === "PHASE_GRADIENT" ? RISMode.PHASE_GRADIENT : RISMode.FOCUSING_LENS));
        params.setNumModes(numModes);
        params.setSourceNamesList(srcs); params.setTargetNamesList(tars);

        try {
            await api.editRIS(params);
            sceneManager.drawRIS(newName, w, nr, nc, posX, posY, posZ, oriX, oriY, oriZ, mode, numModes, srcs, tars, lMode, lPosX, lPosY, lPosZ, lName, true);
            bootstrap.Modal.getInstance(document.getElementById('modal-edit-ris')).hide();
        } catch (err) { console.error(err); }
    });

    document.getElementById('form-add-radio').addEventListener('submit', async (e) => {
        e.preventDefault();

        const type = document.getElementById('radio-type').value;
        const name = document.getElementById('radio-name').value;

        // 1. Validación de nombre y tipo
        if (!name || !name.trim() || !type) {
            alert(`Radio object creation failed: Name and type are required.`);
            return;
        }

        const objects = sceneManager.getObjects();
        if (objects.some(obj => obj.name === name)) {
            alert(`Radio object creation failed: The name "${name}" is already used.`);
            return;
        }

        // 2. Validación de Posición
        const posX = getVal('radio-pos-x');
        const posY = getVal('radio-pos-y');
        const posZ = getVal('radio-pos-z');
        if (isInvalidNum(posX) || isInvalidNum(posY) || isInvalidNum(posZ)) {
            alert(`Radio object creation failed: Position coordinates are missing.`);
            return;
        }

        // 3. Validación de LookAt / Orientación
        const lMode = getCheckedVal('radioLookAtMode');
        const lName = document.getElementById('radio-lookat-obj-select').value;
        let oriX = 0, oriY = 0, oriZ = 0;
        let lPosX = 0, lPosY = 0, lPosZ = 0;

        if (lMode === "orientation") {
            oriX = getVal('radio-ori-x'); oriY = getVal('radio-ori-y'); oriZ = getVal('radio-ori-z');
            if (isInvalidNum(oriX) || isInvalidNum(oriY) || isInvalidNum(oriZ)) {
                alert(`Radio object creation failed: Orientation angles are missing.`);
                return;
            }
        } else if (lMode === "position") {
            lPosX = getVal('radio-lookat-pos-x'); lPosY = getVal('radio-lookat-pos-y'); lPosZ = getVal('radio-lookat-pos-z');
            if (isInvalidNum(lPosX) || isInvalidNum(lPosY) || isInvalidNum(lPosZ)) {
                alert(`Radio object creation failed: LookAt position coordinates are missing.`);
                return;
            }
        } else if (lMode === "object" && !lName) {
            alert(`Radio object creation failed: Target object is missing.`);
            return;
        }

        const params = new NewRadioObjectParameters();
        params.setSessionId(currentSessionId);
        params.setType(type === 'transmitter' ? RadioObjectType.TRANSMITTER : RadioObjectType.RECEIVER);
        params.setName(name);

        const pos = new Vector(); pos.setX(posX); pos.setY(posY); pos.setZ(posZ);
        params.setPosition(pos);

        const ori = new Vector(); const lPos = new Vector();
        if (lMode === "orientation") {
            params.setLookAtMode(LookAtMode.MODE_ORIENTATION);
            ori.setX(oriX); ori.setY(oriY); ori.setZ(oriZ);
        } else if (lMode === "position") {
            params.setLookAtMode(LookAtMode.MODE_POSITION);
            lPos.setX(lPosX); lPos.setY(lPosY); lPos.setZ(lPosZ);
        } else {
            params.setLookAtMode(LookAtMode.MODE_OBJECT);
            params.setLookAtName(lName);
        }
        params.setOrientation(ori); params.setLookAtPosition(lPos);

        try {
            await api.createRadioObject(params);
            sceneManager.drawRadioObject(type, name, posX, posY, posZ, lMode, lPosX, lPosY, lPosZ, oriX, oriY, oriZ, lName);
            bootstrap.Modal.getInstance(document.getElementById('modal-add-radio')).hide();
            e.target.reset();
        } catch (err) { console.error(err); }
    });

    document.getElementById('form-edit-radio').addEventListener('submit', async (e) => {
        e.preventDefault();

        const type = document.getElementById('edit-radio-type').value;
        const oldName = document.getElementById('edit-radio-oldname').value;
        const newName = document.getElementById('edit-radio-name').value;

        // 1. Validación de nombre y tipo
        if (!newName || !newName.trim() || !type) {
            alert(`Edit Radio object failed: Name and type are required.`);
            return;
        }

        if (oldName !== newName) {
            const objects = sceneManager.getObjects();
            if (objects.some(obj => obj.name === newName)) {
                alert(`Edit Radio object failed: The name "${newName}" is already used.`);
                return;
            }
        }

        // 2. Validación de Posición
        const posX = getVal('edit-radio-pos-x');
        const posY = getVal('edit-radio-pos-y');
        const posZ = getVal('edit-radio-pos-z');
        if (isInvalidNum(posX) || isInvalidNum(posY) || isInvalidNum(posZ)) {
            alert(`Edit Radio object failed: Position coordinates are missing.`);
            return;
        }

        // 3. Validación de LookAt / Orientación
        const lMode = getCheckedVal('editRadioLookAtMode');
        const lName = document.getElementById('edit-radio-lookat-obj-select').value;
        let oriX = 0, oriY = 0, oriZ = 0;
        let lPosX = 0, lPosY = 0, lPosZ = 0;

        if (lMode === "orientation") {
            oriX = getVal('edit-radio-ori-x'); oriY = getVal('edit-radio-ori-y'); oriZ = getVal('edit-radio-ori-z');
            if (isInvalidNum(oriX) || isInvalidNum(oriY) || isInvalidNum(oriZ)) {
                alert(`Edit Radio object failed: Orientation angles are missing.`);
                return;
            }
        } else if (lMode === "position") {
            lPosX = getVal('edit-radio-lookat-pos-x'); lPosY = getVal('edit-radio-lookat-pos-y'); lPosZ = getVal('edit-radio-lookat-pos-z');
            if (isInvalidNum(lPosX) || isInvalidNum(lPosY) || isInvalidNum(lPosZ)) {
                alert(`Edit Radio object failed: LookAt position coordinates are missing.`);
                return;
            }
        } else if (lMode === "object" && !lName) {
            alert(`Edit Radio object failed: Target object is missing.`);
            return;
        }

        const params = new EditRadioObjectParameters();
        params.setSessionId(currentSessionId);
        params.setType(type === 'transmitter' ? RadioObjectType.TRANSMITTER : RadioObjectType.RECEIVER);
        params.setOldname(oldName);
        params.setNewname(newName);

        const pos = new Vector(); pos.setX(posX); pos.setY(posY); pos.setZ(posZ);
        params.setPosition(pos);

        const ori = new Vector(); const lPos = new Vector();
        if (lMode === "orientation") {
            params.setLookAtMode(LookAtMode.MODE_ORIENTATION);
            ori.setX(oriX); ori.setY(oriY); ori.setZ(oriZ);
        } else if (lMode === "position") {
            params.setLookAtMode(LookAtMode.MODE_POSITION);
            lPos.setX(lPosX); lPos.setY(lPosY); lPos.setZ(lPosZ);
        } else {
            params.setLookAtMode(LookAtMode.MODE_OBJECT);
            params.setLookAtName(lName);
        }
        params.setOrientation(ori); params.setLookAtPosition(lPos);

        try {
            await api.editRadioObject(params);
            sceneManager.drawRadioObject(type, newName, posX, posY, posZ, lMode, lPosX, lPosY, lPosZ, oriX, oriY, oriZ, lName, true);
            bootstrap.Modal.getInstance(document.getElementById('modal-edit-radio')).hide();
        } catch (err) { console.error(err); }
    });

    document.getElementById('form-config-arrays').addEventListener('submit', async (e) => {
        e.preventDefault();

        const type = document.getElementById('arrays-type').value;
        const numRows = parseFloat(document.getElementById('arrays-numRows').value);
        const numCols = parseFloat(document.getElementById('arrays-numCols').value);
        const verticalSpacing = parseFloat(document.getElementById('arrays-vSpacing').value);
        const horizontalSpacing = parseFloat(document.getElementById('arrays-hSpacing').value);
        const pattern = document.getElementById('arrays-pattern').value;
        const polarization = document.getElementById('arrays-polarization').value;

        // Configurar mensaje gRPC
        const params = new ConfigurePlanarArraysParameters();
        params.setSessionId(currentSessionId);
        params.setType(type === 'transmitter' ? RadioObjectType.TRANSMITTER : RadioObjectType.RECEIVER);
        params.setNumrows(numRows);
        params.setNumcols(numCols);
        params.setVerticalspacing(verticalSpacing);
        params.setHorizontalspacing(horizontalSpacing);
        params.setPattern(pattern);
        params.setPolarization(polarization);

        try {
            await api.configurePlanarArrays(params);
            if (type === 'transmitter' ? planarArrayTxConfigured = true : planarArrayRxConfigured = true);
            bootstrap.Modal.getInstance(document.getElementById('modal-config-arrays')).hide();
        } catch (err) { }
    });

    document.getElementById('form-ray-tracing').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentSessionId) return;
        if (!validateSimulationPrerequisites()) return;
        bootstrap.Modal.getInstance(document.getElementById('modal-ray-tracing')).hide();
        const req = new RayTracingParameters();
        req.setSessionId(currentSessionId);
        req.setMaxDepth(getVal('rt-max-depth'));
        req.setMethod(document.getElementById('rt-method').value);
        req.setNumSamples(getVal('rt-num-samples'));
        req.setLos(document.getElementById('rt-los').checked);
        req.setReflection(document.getElementById('rt-reflection').checked);
        req.setDiffraction(document.getElementById('rt-diffraction').checked);
        req.setScattering(document.getElementById('rt-scattering').checked);
        req.setRis(document.getElementById('rt-ris').checked);
        req.setEdgeDiffraction(document.getElementById('rt-edge-diffraction').checked);

        const btn = document.getElementById('btn-ray-tracing');
        const ogText = btn.innerText; btn.innerText = "Simulating..."; btn.disabled = true;

        try {
            const res = await api.computeRayTracing(req);
            sceneManager.drawRays(res.getPathsList());
        } catch (err) { console.error(err); } finally {
            btn.innerText = ogText; btn.disabled = false;
        }
    });

    document.getElementById('form-coverage-map').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentSessionId) return;
        if (!validateSimulationPrerequisites()) return;
        bootstrap.Modal.getInstance(document.getElementById('modal-coverage-map')).hide();

        const params = new CoverageMapParameters();
        params.setSessionId(currentSessionId);

        params.setMaxDepth(parseInt(document.getElementById('cm-max-depth').value));
        params.setNumSamples(parseInt(document.getElementById('cm-num-samples').value));
        params.setNumRuns(parseInt(document.getElementById('cm-num-runs').value));

        params.setLos(document.getElementById('cm-los').checked);
        params.setReflection(document.getElementById('cm-reflection').checked);
        params.setDiffraction(document.getElementById('cm-diffraction').checked);
        params.setScattering(document.getElementById('cm-scattering').checked);
        params.setRis(document.getElementById('cm-ris').checked);
        params.setEdgeDiffraction(document.getElementById('cm-edge-diffraction').checked);

        params.setVmin(parseFloat(document.getElementById('cm-vmin').value));
        params.setVmax(parseFloat(document.getElementById('cm-vmax').value));
        params.setShowRis(document.getElementById('cm-show-ris').checked);
        params.setShowRx(document.getElementById('cm-show-rx').checked);
        params.setShowCoverageGain(document.getElementById('cm-show-coverage-gain').checked);

        // Vectores opcionales (Center)
        const cx = document.getElementById('cm-cx').value;
        const cy = document.getElementById('cm-cy').value;
        const cz = document.getElementById('cm-cz').value;
        if (cx && cy && cz) {
            params.setCmCenterList([parseFloat(cx), parseFloat(cy), parseFloat(cz)]);
        }

        // Vectores opcionales (Size)
        const sw = document.getElementById('cm-sw').value;
        const sh = document.getElementById('cm-sh').value;
        if (sw && sh) {
            params.setCmSizeList([parseFloat(sw), parseFloat(sh)]);
        }

        const ox = document.getElementById('cm-ox').value;
        const oy = document.getElementById('cm-oy').value;
        const oz = document.getElementById('cm-oz').value;
        if (ox && oy && oz) {
            params.setCmOrientationList([parseFloat(ox), parseFloat(oy), parseFloat(oz)]);
        }

        // Vectores obligatorios con por defecto (Cell Size)
        params.setCmCellSizeList([
            parseFloat(document.getElementById('cm-cw').value),
            parseFloat(document.getElementById('cm-ch').value)
        ]);

        // Deshabilitar botón temporalmente y mostrar estado
        const btnRun = document.getElementById('btn-coverage-map');
        const originalText = btnRun.innerText;
        btnRun.innerText = "Simulating...";
        btnRun.disabled = true;

        try {
            const response = await api.computeCoverageMap(params);

            const cmBase64 = response.getCoverageMapBase64();
            const cmNoRisBase64 = response.getCoverageMapNoRisBase64();
            const gainBase64 = response.getCoverageGainBase64();
            const showGain = document.getElementById('cm-show-coverage-gain').checked;

            const container = document.getElementById('coverage-maps-container');
            container.innerHTML = ''; // Limpiar mapa previo

            if (showGain && cmNoRisBase64 && gainBase64) {
                container.innerHTML = `
            <div class="row g-3">
                <div class="col-md-4">
                    <h6 class="fw-bold">Coverage Map (No RIS)</h6>
                    <img src="data:image/png;base64,${cmNoRisBase64}" class="img-fluid border rounded shadow">
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold">Coverage Map (With RIS)</h6>
                    <img src="data:image/png;base64,${cmBase64}" class="img-fluid border rounded shadow">
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold">RIS Coverage Gain</h6>
                    <img src="data:image/png;base64,${gainBase64}" class="img-fluid border rounded shadow">
                </div>
            </div>
        `;
            } else if (cmBase64) {
                container.innerHTML = `
            <img src="data:image/png;base64,${cmBase64}" class="img-fluid border rounded shadow">
        `;
            }
            new bootstrap.Modal(document.getElementById('modal-show-coverage-map')).show();
        } catch (err) { } finally {
            btnRun.innerText = originalText;
            btnRun.disabled = false;
        }
    });

    document.getElementById('form-load-scene').addEventListener('submit', async (e) => {
        e.preventDefault();
        const sceneName = document.getElementById('scene-selection').value;
        const freq = parseFloat(getVal('scene-frequency'));
        const req = new LoadSceneParameters();
        req.setSessionId(currentSessionId); req.setPath(sceneName); req.setFrequency(freq);

        const btn = e.target.querySelector('button[type="submit"]');
        btn.innerText = "Loading..."; btn.disabled = true;

        try {
            await api.loadScene(req);
            sceneManager.loadSceneModel(sceneName);
            bootstrap.Modal.getInstance(document.getElementById('modal-load-scene')).hide();
        } catch (err) { } finally { btn.innerText = "Load scene"; btn.disabled = false; }
    });

    // Lógica de exportar e importar sesión

    document.getElementById('btn-export').addEventListener('click', async () => {
        if (!currentSessionId) return;

        const request = new SaveSessionParameters();
        request.setSessionId(currentSessionId);

        try {
            const response = await api.saveSession(request);

            if (!response.getSuccess()) {
                throw new Error("Server rejected the save session request.");
            }

            const jsonData = response.getJsonData();
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = url;
            a.download = `ris_session_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();

            // Limpieza del DOM
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (err) {
            console.error("Error exporting session:", err);
            alert("Error exporting session. Check console for details.");
        }
    });


    document.getElementById('form-import-session').addEventListener('submit', (event) => {
        event.preventDefault();
        if (!currentSessionId) return;

        const fileInput = document.getElementById('import-file-input');
        if (!fileInput.files || fileInput.files.length === 0) return;

        const file = fileInput.files[0];
        const reader = new FileReader();

        // Envolvemos el callback del FileReader en una función asíncrona
        reader.onload = async (e) => {
            const jsonData = e.target.result;
            const request = new LoadSessionParameters();

            request.setSessionId(currentSessionId);
            request.setJsonData(jsonData);

            const btnSubmit = event.target.querySelector('button[type="submit"]');
            const originalText = btnSubmit.innerText;
            btnSubmit.innerText = "Importing...";
            btnSubmit.disabled = true;

            try {
                const response = await api.loadSession(request);

                if (!response.getSuccess()) {
                    throw new Error("Server failed to load the session.");
                }

                // Restauramos estado en el Frontend
                const data = JSON.parse(response.getJsonData());

                // 1. Limpiar la escena 3D delegando al SceneManager
                sceneManager.clearSceneObjects();

                // 2. Renderizar malla 3D de la escena si procede
                const sceneName = data.scene_path || "empty";
                sceneManager.loadSceneModel(sceneName);

                // 3. Re-dibujar Radio Objects
                const radioConfigs = data.radio_configs || {};
                Object.values(radioConfigs).forEach(radio => {
                    const type = (radio.type === 'TRANSMITTER' || radio.type === 0) ? 'transmitter' : 'receiver';
                    const name = radio.name;
                    const pos = radio.position || {};
                    const ori = radio.orientation || {};

                    const px = pos.X || pos.x || 0;
                    const py = pos.Y || pos.y || 0;
                    const pz = pos.Z || pos.z || 0;
                    const ox = ori.X || ori.x || 0;
                    const oy = ori.Y || ori.y || 0;
                    const oz = ori.Z || ori.z || 0;

                    let lookAtMode = "orientation";
                    if (radio.look_at_mode === "MODE_POSITION" || radio.look_at_mode === 1) lookAtMode = "position";
                    if (radio.look_at_mode === "MODE_OBJECT" || radio.look_at_mode === 2) lookAtMode = "object";

                    const lPos = radio.look_at_position || radio.lookAtPosition || {};
                    const lpx = lPos.X || lPos.x || 0;
                    const lpy = lPos.Y || lPos.y || 0;
                    const lpz = lPos.Z || lPos.z || 0;
                    const lookAtName = radio.look_at_name || radio.lookAtName || '';

                    sceneManager.drawRadioObject(type, name, px, py, pz, lookAtMode, lpx, lpy, lpz, ox, oy, oz, lookAtName);
                });

                // 4. Re-dibujar objetos RIS
                const risConfigs = data.ris_configs || {};
                Object.values(risConfigs).forEach(ris => {
                    const name = ris.name;
                    const width = ris.width || 2;
                    const numRows = ris.num_rows || ris.numRows || 40;
                    const numCols = ris.num_cols || ris.numCols || 40;
                    const pos = ris.position || {};
                    const ori = ris.orientation || {};

                    const px = pos.X || pos.x || 0;
                    const py = pos.Y || pos.y || 0;
                    const pz = pos.Z || pos.z || 0;
                    const ox = ori.X || ori.x || 0;
                    const oy = ori.Y || ori.y || 0;
                    const oz = ori.Z || ori.z || 0;

                    let mode = "NONE";
                    if (ris.mode === "PHASE_GRADIENT" || ris.mode === 1) mode = "PHASE_GRADIENT";
                    if (ris.mode === "FOCUSING_LENS" || ris.mode === 2) mode = "FOCUSING_LENS";

                    const numModes = ris.num_modes || ris.numModes || 1;
                    const srcTransmitterNames = ris.source_names || ris.sourceNames || [];
                    const tarReceiverNames = ris.target_names || ris.targetNames || [];

                    let lookAtMode = "orientation";
                    if (ris.look_at_mode === "MODE_POSITION" || ris.look_at_mode === 1) lookAtMode = "position";
                    if (ris.look_at_mode === "MODE_OBJECT" || ris.look_at_mode === 2) lookAtMode = "object";

                    const lPos = ris.look_at_position || ris.lookAtPosition || {};
                    const lpx = lPos.X || lPos.x || 0;
                    const lpy = lPos.Y || lPos.y || 0;
                    const lpz = lPos.Z || lPos.z || 0;
                    const lookAtName = ris.look_at_name || ris.lookAtName || '';

                    sceneManager.drawRIS(name, width, numRows, numCols, px, py, pz, ox, oy, oz, mode, numModes, srcTransmitterNames, tarReceiverNames, lookAtMode, lpx, lpy, lpz, lookAtName);
                });

                // Booleans de planar arrays
                if (data.tx_array ? planarArrayTxConfigured = true : planarArrayTxConfigured = false);
                if (data.rx_array ? planarArrayRxConfigured = true : planarArrayRxConfigured = false);

                // Ocultar modal y resetear el formulario
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modal-import-session'));
                if (modalInstance) modalInstance.hide();
                event.target.reset();

            } catch (err) {
                console.error("Error importing session:", err);
                alert("Failed to import session. Check console for details.");
            } finally {
                // Restauramos estado del botón independientemente del resultado
                btnSubmit.innerText = originalText;
                btnSubmit.disabled = false;
            }
        };

        // Iniciamos la lectura del archivo
        reader.readAsText(file);
    });
}

document.addEventListener('DOMContentLoaded', startApp);