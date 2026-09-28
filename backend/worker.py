import sys
import ris_pb2
import ris_pb2_grpc
import grpc
from concurrent import futures
import queue
import traceback
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
from google.protobuf.json_format import MessageToDict, ParseDict

import os
# Configure which GPU
if os.getenv("CUDA_VISIBLE_DEVICES") is None:
    gpu_num = 0 
    os.environ["CUDA_VISIBLE_DEVICES"] = f"{gpu_num}"
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ["MI_DEFAULT_VARIANT"] = "llvm_ad_rgb"

import numpy as np
import sionna
from sionna.rt import RIS, PlanarArray, Transmitter, Receiver, load_scene, Camera, RadioMaterial
from sionna.rt import scene

# Cola global para comunicar hilos gRPC con el hilo principal
task_queue = queue.Queue()

class RISWorkerServicer(ris_pb2_grpc.RISServiceServicer):
    def __init__(self):
        print("[WORKER] Inicializando motor Mitsuba/Sionna en el hilo principal...")
        self.scene = load_scene()
        sionna.config.seed = 42

        self.objects = {}
        # Almacenamiento del estado para poder restaurarlo al cambiar de escena
        self.radio_configs = {}
        self.ris_configs = {}
        self.tx_array_req = None
        self.rx_array_req = None
        self.current_scene_path = "empty"
        self.frequency = 3.5
        print("[WORKER] Escena vacía creada con éxito.")

    def _run_in_main_thread(self, func, *args, **kwargs):
        """
        Envía la función para que se ejecute en el hilo principal
        y bloquea el hilo de gRPC hasta obtener el resultado.
        """
        future = futures.Future()
        task_queue.put((func, args, kwargs, future))
        return future.result()

    # Tareas del hilo principal
    
    def _load_scene_task(self, request):
        try:
            self.current_scene_path = request.path
            self.frequency = request.frequency
            # 1. Cargamos la nueva escena
            sceneToLoad=""
            match request.path:
                case "empty":
                    sceneToLoad=""
                case "floor_wall":
                    sceneToLoad=sionna.rt.scene.floor_wall
                case "simple_street_canyon":
                    sceneToLoad=sionna.rt.scene.simple_street_canyon
                case "simple_street_canyon_with_cars":
                    sceneToLoad=sionna.rt.scene.simple_street_canyon_with_cars
                case "etoile":
                    sceneToLoad=sionna.rt.scene.etoile
                case "munich":
                    sceneToLoad=sionna.rt.scene.munich
                case "simple_wedge":
                    sceneToLoad=sionna.rt.scene.simple_wedge
                case "simple_reflector":
                    sceneToLoad=sionna.rt.scene.simple_reflector
                case "double_reflector":
                    sceneToLoad=sionna.rt.scene.double_reflector
                case "triple_reflector":
                    sceneToLoad=sionna.rt.scene.triple_reflector
                case "box":
                    sceneToLoad=sionna.rt.scene.box

            if(request.path!="empty"):
                self.scene = load_scene(sceneToLoad)
            else:
                self.scene._clear()
            
            self.objects.clear()
            
            # 2. Restauramos la configuración de los planar arrays
            if self.tx_array_req: self._config_arrays_task(self.tx_array_req)
            if self.rx_array_req: self._config_arrays_task(self.rx_array_req)
        
            # 3. Restauramos los radio objects
            for req in self.radio_configs.values():
                self._create_radio_task(req, restore_mode=True)
            
            # 4. Restauramos las ris
            for req in self.ris_configs.values():
                self._create_ris_task(req, restore_mode=True)

            freq = request.frequency*(1e9)
            self.scene.frequency = freq
            return ris_pb2.SuccessResponse(success=True, message=f"Scene '{request.path}' loaded and objects restored.")
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.SuccessResponse(success=False, message=f"Error loading scene: {str(e)}")

    def _create_ris_task(self, request, restore_mode=False):
        try:
            if request.width > 0:
                numRows = numCols = int(request.width / (0.5 * self.scene.wavelength))
            else:
                numRows = request.numRows
                numCols = request.numCols

            look_at_target = None
            orientation_vector = [0.0, 0.0, 0.0]

            if request.look_at_mode == ris_pb2.MODE_OBJECT:
                if request.look_at_name and request.look_at_name in self.objects:
                    look_at_target = self.objects[request.look_at_name]
                else:
                    look_at_target = [0.0, 0.0, 0.0]
            elif request.look_at_mode == ris_pb2.MODE_POSITION:
                look_at_target = [request.look_at_position.X, request.look_at_position.Y, request.look_at_position.Z]
            else:
                orientation_vector = [request.orientation.X, request.orientation.Y, request.orientation.Z]

            numModes = request.num_modes if request.num_modes > 0 else 1
            try:
                newRis = RIS(name=request.name,
                            position=[request.position.X, request.position.Y, request.position.Z],
                            orientation=orientation_vector,
                            look_at=look_at_target,
                            num_rows=numRows,
                            num_cols=numCols,
                            num_modes=numModes)
            except Exception:
                        traceback.print_exc()

            #Para evitar crashes al cargar escenas vacías
            if "itu_metal" not in self.scene.radio_materials:
                metal_material = RadioMaterial("itu_metal", relative_permittivity=1.0, conductivity=1e7)
                self.scene.add(metal_material)

            self.scene.add(newRis)

            if request.mode != ris_pb2.NONE:
                source_positions= []
                target_positions= []
                for source_name in list(request.source_names):
                    if source_name in self.objects:
                        source_positions.append(self.objects[source_name].position)
                    else:
                        print(f"[WORKER] Warning: Source '{source_name}' not found.")
                
                for target_name in list(request.target_names):
                    if target_name in self.objects:
                        target_positions.append(self.objects[target_name].position)
                    else:
                        print(f"[WORKER] Warning: Target '{target_name}' not found.")

                if request.mode == ris_pb2.PHASE_GRADIENT:
                    try:
                        newRis.phase_gradient_reflector(source_positions, target_positions)
                    except Exception:
                        traceback.print_exc()
                elif request.mode == ris_pb2.FOCUSING_LENS:
                    try:
                        newRis.focusing_lens(source_positions, target_positions)
                    except Exception:
                        traceback.print_exc()
            
            self.objects[request.name] = newRis
            if not restore_mode:
                self.ris_configs[request.name] = request
            return ris_pb2.SuccessResponse(success=True, message="RIS created.")
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.SuccessResponse(success=False, message=f"Error creating RIS: {str(e)}")
        

    def _edit_ris_task(self, request):
        try:
            self.scene.remove(request.oldName)
            
            if request.oldName in self.objects:
                del self.objects[request.oldName]
                
            if request.oldName in self.ris_configs:
                del self.ris_configs[request.oldName]

            clean_config = MessageToDict(request, preserving_proto_field_name=True, including_default_value_fields=True)
            clean_config.pop("oldName", None)
            clean_config.pop("newName", None)
            clean_config["name"] = request.newName

            new_request = ris_pb2.NewRISParameters()
            ParseDict(clean_config, new_request)

            self._create_ris_task(new_request)

        except Exception as e:
            traceback.print_exc()
            return ris_pb2.SuccessResponse(success=False, message=f"Error al editar la RIS: {str(e)}")

        return ris_pb2.SuccessResponse(success=True, message="RIS edited.")

    def _delete_object_task(self, name):
        self.scene.remove(name)

        if name in self.objects:
            del self.objects[name]
        if name in self.radio_configs:
            del self.radio_configs[name]
        if name in self.ris_configs:
            del self.ris_configs[name]

        return ris_pb2.SuccessResponse(success=True, message="Object deleted.")

    def _config_arrays_task(self, request):
        if request.type == ris_pb2.RadioObjectType.TRANSMITTER:
            self.tx_array_req = request
            self.scene.tx_array = PlanarArray(num_rows=request.numRows,
                         num_cols=request.numCols,
                         vertical_spacing=request.verticalSpacing,
                         horizontal_spacing=request.horizontalSpacing,
                         pattern=request.pattern,
                         polarization=request.polarization)    
        elif request.type == ris_pb2.RadioObjectType.RECEIVER:
            self.rx_array_req = request
            self.scene.rx_array = PlanarArray(num_rows=request.numRows,
                         num_cols=request.numCols,
                         vertical_spacing=request.verticalSpacing,
                         horizontal_spacing=request.horizontalSpacing,
                         pattern=request.pattern,
                         polarization=request.polarization)   
        return ris_pb2.SuccessResponse(success=True, message="Planar array configured.")

    def _create_radio_task(self, request, restore_mode=False):
        pos_vector = [request.position.X, request.position.Y, request.position.Z]
        look_at_target = None
        orientation_vector = None

        look_at_target = None
        orientation_vector = None

        if request.look_at_mode == ris_pb2.MODE_OBJECT:
            if request.look_at_name and request.look_at_name in self.objects:
                look_at_target = self.objects[request.look_at_name]
            else:
                look_at_target = [0.0, 0.0, 0.0]
        elif request.look_at_mode == ris_pb2.MODE_POSITION:
            look_at_target = [request.look_at_position.X, request.look_at_position.Y, request.look_at_position.Z]
        else:
            orientation_vector = [request.orientation.X, request.orientation.Y, request.orientation.Z]

        if request.type == ris_pb2.RadioObjectType.TRANSMITTER:
            new_device = Transmitter(name=request.name, position=pos_vector, orientation=orientation_vector, look_at=look_at_target)      
        elif request.type == ris_pb2.RadioObjectType.RECEIVER:
            new_device = Receiver(name=request.name, position=pos_vector, orientation=orientation_vector, look_at=look_at_target)
        
        self.scene.add(new_device)
        self.objects[request.name] = new_device

        if not restore_mode:
            self.radio_configs[request.name] = request
            
        return ris_pb2.SuccessResponse(success=True, message=f"Radio object {request.name} created.")

    def _edit_radio_task(self, request):
        try:
            if request.oldName != request.newName:
                if request.oldName in self.radio_configs:
                    del self.radio_configs[request.oldName]
                    
            self.radio_configs[request.newName] = request
            device = self.scene.get(request.oldName)
            pos_vector = [request.position.X, request.position.Y, request.position.Z]
            look_at_target = None
            orientation_vector = None

            look_at_target = None
            orientation_vector = None

            if request.look_at_mode == ris_pb2.MODE_OBJECT:
                if request.look_at_name and request.look_at_name in self.objects:
                    look_at_target = self.objects[request.look_at_name]
                else:
                    look_at_target = [0.0, 0.0, 0.0]
                device.look_at = look_at_target
            elif request.look_at_mode == ris_pb2.MODE_POSITION:
                look_at_target = [request.look_at_position.X, request.look_at_position.Y, request.look_at_position.Z]
                device.look_at = look_at_target
            else:
                orientation_vector = [request.orientation.X, request.orientation.Y, request.orientation.Z]
                device.orientation = orientation_vector

            #device.name = request.newName
            device.position = pos_vector
                
            self.objects[request.newName] = device
            if request.oldName != request.newName:
                del self.objects[request.oldName]
        except Exception:
            traceback.print_exc()
        return ris_pb2.SuccessResponse(success=True, message=f"Radio object {request.newName} edited.")

    def _update_position_task(self, request):
        obj = self.scene.get(request.name)
        obj.position = [request.position.X, request.position.Y, request.position.Z]

        if request.name in self.radio_configs:
            self.radio_configs[request.name].position.X = request.position.X
            self.radio_configs[request.name].position.Y = request.position.Y
            self.radio_configs[request.name].position.Z = request.position.Z
        elif request.name in self.ris_configs:
            self.ris_configs[request.name].position.X = request.position.X
            self.ris_configs[request.name].position.Y = request.position.Y
            self.ris_configs[request.name].position.Z = request.position.Z
        return ris_pb2.SuccessResponse(success=True, message=f"{request.name}'s position updated.")

    def _compute_ray_tracing_task(self, request):
        if len(self.scene.transmitters) == 0 or len(self.scene.receivers) == 0:
            return ris_pb2.RayTracingResponse(success=False, message="You need at least one transmitter and receiver.")
        
        paths = self.scene.compute_paths(
            max_depth=request.max_depth,
            method=request.method,
            num_samples=request.num_samples,
            los=request.los,
            reflection=request.reflection,
            diffraction=request.diffraction,
            scattering=request.scattering,
            ris=request.ris,
            edge_diffraction=request.edge_diffraction,
        )
        
        # 3. Formatear y retornar response
        # Obtenemos los tensores principales de Sionna
        mask = paths.mask.numpy()          
        vertices = paths.vertices.numpy()  
        objects = paths.objects.numpy()    
        targets = paths.targets.numpy()    
        sources = paths.sources.numpy()    
        
        response = ris_pb2.RayTracingResponse(success=True, message="Simulation finished.")
        valid_indices = np.argwhere(mask == True)
        
        print(f"[WORKER] Simulation finished. Valid paths found: {len(valid_indices)}")
        print(f"Simulation and path details:")

        print("Source coordinates: ", sources)
        print("Transmitter coordinates: ", list(self.scene.transmitters.values())[0].position.numpy())
        print("Target coordinates: ", targets)
        print("Receiver coordinates: ",list(self.scene.receivers.values())[0].position.numpy())
        print("Path types: ", paths.types.numpy())

        for path_number,idx in enumerate(valid_indices):
            # Extraemos los índices desde el final para que funcione con 1 o más transmisores/receptores
            path_idx = idx[-1]
            tx_idx = idx[-2]
            rx_idx = idx[-3]
            batch_idx = idx[-4] if len(idx) >= 4 else 0
            
            if vertices.ndim == 6:
                hit_points = vertices[batch_idx, rx_idx, tx_idx, path_idx]
            else:
                hit_points = vertices[:, rx_idx, tx_idx, path_idx, :]
                
            if objects.ndim == 5:
                hit_objects = objects[batch_idx, rx_idx, tx_idx, path_idx]
            else:
                hit_objects = objects[:, rx_idx, tx_idx, path_idx]
            
            ray_msg = response.paths.add()
            
            # 1. Punto de origen (Antena Transmisora)
            if sources.ndim == 3:   
                s_pos = sources[batch_idx, tx_idx]
            else: 
                s_pos = sources[tx_idx]
                
            tx_vec = ray_msg.points.add()
            tx_vec.X, tx_vec.Y, tx_vec.Z = float(s_pos[0]), float(s_pos[1]), float(s_pos[2])
            
            # 2. Puntos de rebote intermedios en el entorno/RIS
            for i, hit_obj in enumerate(hit_objects):
                if hit_obj != -1: # -1 significa padding vacío
                    v = hit_points[i]
                    vec = ray_msg.points.add()
                    vec.X, vec.Y, vec.Z = float(v[0]), float(v[1]), float(v[2])
                    
            # 3. Punto de destino (Antena Receptora)
            if targets.ndim == 3:   
                t_pos = targets[batch_idx, rx_idx]
            else: 
                t_pos = targets[rx_idx]
                
            rx_vec = ray_msg.points.add()
            rx_vec.X, rx_vec.Y, rx_vec.Z = float(t_pos[0]), float(t_pos[1]), float(t_pos[2])
                
        return response
    
    def _compute_coverage_map_task(self, request):
        try:
            # Gestionar listas vacías (None) para los valores automáticos
            cm_center = list(request.cm_center) if request.cm_center else None
            cm_size = list(request.cm_size) if request.cm_size else None
            cm_orientation = list(request.cm_orientation) if request.cm_orientation else None
            cm_cell_size = list(request.cm_cell_size) if request.cm_cell_size else [1.0, 1.0]

            cm_kwargs = {
                "max_depth": request.max_depth,
                "num_samples": request.num_samples,
                "los":request.los,
                "reflection":request.reflection,
                "diffraction":request.diffraction,
                "scattering":request.scattering,
                "edge_diffraction":request.edge_diffraction,
                "cm_center":cm_center,
                "cm_size":cm_size,
                "cm_orientation":cm_orientation,
                "cm_cell_size":cm_cell_size,
                "num_runs":request.num_runs,
                "check_scene":False
            }

            # Extraer parámetros estéticos del frontend
            vmin = request.vmin
            vmax = request.vmax
            show_ris = request.show_ris
            show_rx = request.show_rx

            if request.show_coverage_gain:
                # 1. Crear CM sin RIS
                cm_no_ris = self.scene.coverage_map(**cm_kwargs, ris=False)
                fig_no_ris = cm_no_ris.show(vmin=vmin, vmax=vmax, show_ris=show_ris, show_rx=show_rx)
                img_no_ris_base64 = fig_to_base64(fig_no_ris)

                # 2. Crear CM con RIS
                cm_ris = self.scene.coverage_map(**cm_kwargs, ris=True)
                fig_ris = cm_ris.show(vmin=vmin, vmax=vmax, show_ris=show_ris, show_rx=show_rx)
                img_ris_base64 = fig_to_base64(fig_ris)

                # 3. Crear gráfica de coverage gain
                fig_gain = plt.figure()
                
                # Usar un pequeño épsilon np.maximum(..., 1e-15) para evitar el error division-by-zero de Numpy si el path_gain sin RIS es exactamente 0
                ratio = cm_ris.path_gain[0].numpy() / np.maximum(cm_no_ris.path_gain[0].numpy(), 1e-15)
                gain_db = 10 * np.log10(np.maximum(ratio, 1e-15))
                
                plt.imshow(gain_db, origin='lower', vmin=0)
                plt.colorbar(label='Gain [dB]')
                plt.xlabel('Cell index (X-axis)')
                plt.ylabel('Cell index (Y-axis)')
                plt.title("RIS Coverage Gain")
                
                img_gain_base64 = fig_to_base64(fig_gain)

                return ris_pb2.CoverageMapResponse(
                    success=True,
                    message="Coverage maps generated with gain.",
                    coverage_map_base64=img_ris_base64,
                    coverage_map_no_ris_base64=img_no_ris_base64,
                    coverage_gain_base64=img_gain_base64
                )
            
            else:
                # Ejecución estándar
                cm = self.scene.coverage_map(**cm_kwargs, ris=request.ris)
                fig = cm.show(vmin=vmin, vmax=vmax, show_ris=show_ris, show_rx=show_rx)
                img_base64 = fig_to_base64(fig)
                
                return ris_pb2.CoverageMapResponse(
                    success=True,
                    message="Coverage map generated.",
                    coverage_map_base64=img_base64
                )
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.CoverageMapResponse(
                success=False,
                message=f"Error generating coverage map: {str(e)}"
            )
    
    def _save_session_task(self):
        state = {
            "scene_path": self.current_scene_path,
            "freq": self.frequency,
            "tx_array": MessageToDict(self.tx_array_req, preserving_proto_field_name=True, including_default_value_fields=True) if self.tx_array_req else None,
            "rx_array": MessageToDict(self.rx_array_req, preserving_proto_field_name=True, including_default_value_fields=True) if self.rx_array_req else None,
            "radio_configs": {name: MessageToDict(req, preserving_proto_field_name=True, including_default_value_fields=True) for name, req in self.radio_configs.items()},
            "ris_configs": {name: MessageToDict(req, preserving_proto_field_name=True, including_default_value_fields=True) for name, req in self.ris_configs.items()}
        }
        json_str = json.dumps(state)
        return ris_pb2.SaveSessionResponse(success=True, message="Session exported successfully.", json_data=json_str)
    
    def _load_session_task(self, json_str):
        data = json.loads(json_str)

        # 1. Limpiamos estado previo de configuración
        self.radio_configs.clear()
        self.ris_configs.clear()
        self.tx_array_req = None
        self.rx_array_req = None

        # 2. Cargar la escena (esto reiniciará self.objects)
        loadReq = ris_pb2.LoadSceneParameters()
        loadReq.path = data.get("scene_path", "empty")
        loadReq.frequency = data.get("freq")
        self._load_scene_task(loadReq)

        # 3. Restaurar Planar Arrays si existían
        if data.get("tx_array"):
            req = ris_pb2.ConfigurePlanarArraysParameters()
            ParseDict(data["tx_array"], req)
            self._config_arrays_task(req)

        if data.get("rx_array"):
            req = ris_pb2.ConfigurePlanarArraysParameters()
            ParseDict(data["rx_array"], req)
            self._config_arrays_task(req)

        # 4. Restaurar Radio Objects
        for name, radio_dict in data.get("radio_configs", {}).items():
            if "type" not in radio_dict:
                radio_dict["type"] = "TRANSMITTER"
            req = ris_pb2.NewRadioObjectParameters()
            ParseDict(radio_dict, req)
            self._create_radio_task(req)

        # 5. Restaurar RIS Objects
        for name, ris_dict in data.get("ris_configs", {}).items():
            req = ris_pb2.NewRISParameters()
            ParseDict(ris_dict, req)
            self._create_ris_task(req)

        return ris_pb2.LoadSessionResponse(success=True, message="Session loaded successfully.", json_data=json_str)
    
    # Endpoints GRPC
    def InitializeSession(self, request, context):
        return ris_pb2.InitializeSessionReturn(session_id="")

    def LoadScene(self, request, context):
        try:
            return self._run_in_main_thread(self._load_scene_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=f"Error loading scene: {str(e)}")

    def CreateRIS(self, request, context):
        try:
            return self._run_in_main_thread(self._create_ris_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))

    def EditRIS(self, request, context):
        try:
            return self._run_in_main_thread(self._edit_ris_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))

    def DeleteObject(self, request, context):
        try:
            return self._run_in_main_thread(self._delete_object_task, request.name)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))
    
    def ConfigurePlanarArrays(self, request, context):
        try:
            return self._run_in_main_thread(self._config_arrays_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))

    def CreateRadioObject(self, request, context):
        try:
            return self._run_in_main_thread(self._create_radio_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))
    
    def EditRadioObject(self, request, context):
        try:
            return self._run_in_main_thread(self._edit_radio_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))

    def UpdatePosition(self, request, context):
        try:
            return self._run_in_main_thread(self._update_position_task, request)
        except Exception as e:
            return ris_pb2.SuccessResponse(success=False, message=str(e))
    
    def ComputeRayTracing(self, request, context):
        try:
            return self._run_in_main_thread(self._compute_ray_tracing_task, request)
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.RayTracingResponse(success=False, message=str(e))
        
    def ComputeCoverageMap(self, request, context):
        try:
            return self._run_in_main_thread(self._compute_coverage_map_task, request)
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.CoverageMapResponse(success=False, message=str(e))
    
    def SaveSession(self, request, context):
        try:
            return self._run_in_main_thread(self._save_session_task)
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.SaveSessionResponse(success=False, message=str(e), json_data="")

    def LoadSession(self, request, context):
        try:
            return self._run_in_main_thread(self._load_session_task, request.json_data)
        except Exception as e:
            traceback.print_exc()
            return ris_pb2.LoadSessionResponse(success=False, message=str(e), json_data="")

def fig_to_base64(fig):
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight')
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode('utf-8')
        
def serve():
    port = sys.argv[1]
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    ris_pb2_grpc.add_RISServiceServicer_to_server(RISWorkerServicer(), server)

    server.add_insecure_port(f'[::]:{port}')
    server.start()
    print(f"Worker gRPC escuchando en el puerto {port}. Bucle principal listo.")

    # Bucle principal que envia tareas
    try:
        while True:
            try:
                func, args, kwargs, future = task_queue.get(timeout=0.5)
                try:
                    result = func(*args, **kwargs)
                    future.set_result(result)
                except Exception as e:
                    future.set_exception(e)
                
                task_queue.task_done()
            except queue.Empty:
                pass
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == '__main__':
    serve()