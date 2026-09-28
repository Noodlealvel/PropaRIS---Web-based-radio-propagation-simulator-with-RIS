import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { api } from './api.js';
import { UpdatePositionParameters, Vector } from './grpc/ris_pb.js';

export class Scene3DManager {
    constructor(containerId, getSessionIdCb) {
        this.container = document.getElementById(containerId);
        this.getSessionId = getSessionIdCb;
        this.scene3D = new THREE.Scene();
        this.scene3D.background = new THREE.Color(0xf0f0f0);

        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.set(10, 10, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene3D.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(20, 40, 20);
        this.scene3D.add(directionalLight);

        this.gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xCCCCCC);
        this.scene3D.add(this.gridHelper);

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.setMode('translate');
        const gizmo = this.transformControls.getHelper();
        this.scene3D.add(gizmo);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.gltfLoader = new GLTFLoader();
        
        this.state = {
            currentEnvironmentMesh: null,
            objectsList: [],
            drawnRaysList: [],
            hoveredObject: null,
            selectedObject: null,
            isDragging: false,
            dragJustFinished: false
        };

        this._bindEvents();
        this._animationLoop();
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._onWindowResize(), false);

        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.orbitControls.enabled = !event.value;
            this.state.isDragging = event.value;

            const hoverMenu = document.getElementById('ris-hover-menu');
            if (this.state.isDragging) {
                hoverMenu.classList.add('d-none');
                this.container.style.cursor = 'grabbing';
            } else {
                this.container.style.cursor = 'default';
                this.state.dragJustFinished = true;
                setTimeout(() => { this.state.dragJustFinished = false; }, 50);

                if (this.transformControls.object) {
                    this._updatePositionInBackend(this.transformControls.object);
                }
            }
        });

        this.container.addEventListener('mousemove', (e) => this._onMouseMove(e), false);
        this.container.addEventListener('click', (e) => this._onCanvasClick(e), false);
    }

    _onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    _animationLoop() {
        requestAnimationFrame(() => this._animationLoop());
        this.orbitControls.update();
        this.renderer.render(this.scene3D, this.camera);
    }

    _onMouseMove(event) {
        if (this.transformControls.axis !== null || this.state.isDragging) {
            if (this.state.hoveredObject) {
                this._highlightObject(this.state.hoveredObject, false);
                this.state.hoveredObject = null;
            }
            return;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / this.container.clientWidth) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / this.container.clientHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersections = this.raycaster.intersectObjects(this.state.objectsList);

        if (intersections.length > 0) {
            const detectedObject = intersections[0].object;
            if (this.state.hoveredObject !== detectedObject) {
                this._highlightObject(detectedObject, true);
                this.state.hoveredObject = detectedObject;
            }
            this.container.style.cursor = 'pointer';
        } else {
            if (this.state.hoveredObject) {
                this._highlightObject(this.state.hoveredObject, false);
                this.state.hoveredObject = null;
            }
            this.container.style.cursor = 'default';
        }
    }

    _onCanvasClick(event) {
        if (this.state.isDragging || this.state.dragJustFinished || this.transformControls.axis !== null) {
            return;
        }

        const hoverMenu = document.getElementById('ris-hover-menu');
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersections = this.raycaster.intersectObjects(this.state.objectsList);

        if (intersections.length > 0) {
            this.state.selectedObject = intersections[0].object;
            this.transformControls.attach(this.state.selectedObject);
            hoverMenu.style.left = `${event.clientX + 15}px`;
            hoverMenu.style.top = `${event.clientY + 15}px`;
            hoverMenu.classList.remove('d-none');
        } else {
            this.transformControls.detach();
            this.state.selectedObject = null;
            hoverMenu.classList.add('d-none');
        }
    }

    _highlightObject(mesh, activate) {
        if (activate) {
            if (mesh.userData.originalColor === undefined) {
                mesh.userData.originalColor = mesh.material.color.getHex();
            }
            mesh.material.color.setHex(0xffcc00);
        } else {
            mesh.material.color.setHex(mesh.userData.originalColor);
        }
    }

    async _updatePositionInBackend(mesh) {
        const position = new Vector();
        position.setX(mesh.position.x);
        position.setY(-mesh.position.z);
        position.setZ(mesh.position.y);

        const parameters = new UpdatePositionParameters();
        parameters.setSessionId(this.getSessionId());
        parameters.setName(mesh.name);
        parameters.setPosition(position);

        try {
            await api.updatePosition(parameters);
        } catch (err) {
            console.error("Error updating position in backend:", err.message);
        }
    }

    getRIS() {
        return this.state.objectsList;
    }
    getObjects() {
        return this.state.objectsList;
    }

    getSelectedObject() {
        return this.state.selectedObject;
    }

    clearSceneObjects() {
        this.transformControls.detach();
        this.state.selectedObject = null;
        this.state.hoveredObject = null;

        this.state.drawnRaysList.forEach(line => this.scene3D.remove(line));
        this.state.drawnRaysList = [];

        this.state.objectsList.forEach(mesh => this.scene3D.remove(mesh));
        this.state.objectsList = [];

        if (this.state.currentEnvironmentMesh) {
            this.scene3D.remove(this.state.currentEnvironmentMesh);
            this.state.currentEnvironmentMesh = null;
        }
    }

    loadSceneModel(sceneName) {
        if (this.state.currentEnvironmentMesh) {
            this.scene3D.remove(this.state.currentEnvironmentMesh);
            this.state.currentEnvironmentMesh = null;
        }

        if (sceneName !== "empty") {
            this.scene3D.remove(this.gridHelper);
            const modelPath = `../assets/scenes/${sceneName}.glb`;
            this.gltfLoader.load(
                modelPath,
                (gltf) => {
                    this.state.currentEnvironmentMesh = gltf.scene;
                    this.state.currentEnvironmentMesh.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            if (child.material) child.material.needsUpdate = true;
                        }
                    });
                    this.scene3D.add(this.state.currentEnvironmentMesh);
                },
                undefined,
                (error) => console.warn(`Could not load ${modelPath} visually.`)
            );
        } else {
            this.scene3D.add(this.gridHelper);
        }
    }

    removeSelectedObject() {
        if (!this.state.selectedObject) return null;
        const name = this.state.selectedObject.name;
        this.transformControls.detach();
        this.scene3D.remove(this.state.selectedObject);
        this.state.objectsList = this.state.objectsList.filter(m => m.name !== name);
        this.state.selectedObject = null;
        return name;
    }

    drawRIS(name, width, numRows, numCols, x, y, z, oriX, oriY, oriZ, mode, numModes, srcTransmitterNames, tarReceiverNames, lookAtMode, lookAtPosX, lookAtPosY, lookAtPosZ, lookAtName, isEdit = false) {
        let RISMesh = isEdit ? this.state.objectsList.find(m => m.name === name) : null;
        const visualWidth = width > 0 ? width : Math.max(numRows, numCols) * 0.05;
        const geometry = new THREE.PlaneGeometry(visualWidth, visualWidth);

        if (!RISMesh) {
            const material = new THREE.MeshStandardMaterial({
                color: 0x0077ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8
            });
            RISMesh = new THREE.Mesh(geometry, material);
            this.scene3D.add(RISMesh);
            this.state.objectsList.push(RISMesh);
        } else {
            RISMesh.geometry = geometry;
        }

        RISMesh.position.set(x, z, -y);
        RISMesh.name = name;

        if (lookAtMode === "object" && lookAtName) {
            const targetMesh = this.state.objectsList.find(m => m.name === lookAtName);
            if (targetMesh) RISMesh.lookAt(targetMesh.position);
        } else if (lookAtMode === "position") {
            RISMesh.lookAt(new THREE.Vector3(lookAtPosX, lookAtPosZ, -lookAtPosY));
        } else {
            RISMesh.rotation.set(
                THREE.MathUtils.degToRad(oriX),
                THREE.MathUtils.degToRad(oriZ),
                THREE.MathUtils.degToRad(oriY)
            );
            RISMesh.rotateY(Math.PI / 2);
        }

        RISMesh.userData = {
            originalColor: 0x0077ff,
            sionnaParameters: {
                type: "RIS", width, numRows, numCols, oriX, oriY, oriZ,
                lookAtMode, lookAtPosX, lookAtPosY, lookAtPosZ, lookAtName, mode, numModes: numModes || 1,
                profileConfig: { srcTransmitterNames: srcTransmitterNames || [], tarReceiverNames: tarReceiverNames || [] }
            }
        };

        if (!isEdit) this.transformControls.attach(RISMesh);
    }

    drawRadioObject(type, name, x, y, z, lookAtMode, lookAtPosX, lookAtPosY, lookAtPosZ, ox, oy, oz, lookAtName, isEdit = false) {
        let radioMesh = isEdit ? this.state.objectsList.find(m => m.name === name) : null;
        const colorHex = (type === 'transmitter') ? 0xff0000 : 0x00ff00;

        if (!radioMesh) {
            const geometry = new THREE.SphereGeometry(0.25, 32, 32);
            const material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.1 });
            radioMesh = new THREE.Mesh(geometry, material);
            this.scene3D.add(radioMesh);
            this.state.objectsList.push(radioMesh);
        } else {
            radioMesh.material.color.setHex(colorHex);
        }

        radioMesh.position.set(x, z, -y);
        radioMesh.name = name;
        
        radioMesh.userData = {
            originalColor: colorHex,
            sionnaParameters: {
                type, lookAtMode, lookAtPosX, lookAtPosY, lookAtPosZ, oriX: ox, oriY: oy, oriZ: oz, lookAtName
            }
        };

        if (lookAtMode === "object" && lookAtName) {
            const targetMesh = this.state.objectsList.find(m => m.name === lookAtName);
            if (targetMesh) radioMesh.lookAt(targetMesh.position);
        } else if (lookAtMode === "position") {
            radioMesh.lookAt(new THREE.Vector3(lookAtPosX, lookAtPosZ, -lookAtPosY));
        } else {
            radioMesh.rotation.set(THREE.MathUtils.degToRad(ox), THREE.MathUtils.degToRad(oy), THREE.MathUtils.degToRad(oz));
        }

        if (!isEdit) this.transformControls.attach(radioMesh);
    }

    drawRays(pathsList) {
        this.state.drawnRaysList.forEach(line => this.scene3D.remove(line));
        this.state.drawnRaysList = [];

        const rayMaterial = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8, linewidth: 2 });

        pathsList.forEach((path) => {
            const points = path.getPointsList();
            const vector3Points = points.map(p => new THREE.Vector3(p.getX(), p.getZ(), -p.getY()));
            const rayGeometry = new THREE.BufferGeometry().setFromPoints(vector3Points);
            const rayLine = new THREE.Line(rayGeometry, rayMaterial);
            
            this.scene3D.add(rayLine);
            this.state.drawnRaysList.push(rayLine);
        });
    }
}