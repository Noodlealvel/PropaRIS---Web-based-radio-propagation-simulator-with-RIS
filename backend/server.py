import grpc
import ris_pb2
import ris_pb2_grpc
from concurrent import futures
import subprocess
import socket
import uuid
import time
import os
import sys

def get_free_port():
    """Encuentra un puerto libre en el sistema operativo."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class RISMasterServicer(ris_pb2_grpc.RISServiceServicer):
    def __init__(self):
        # Diccionario para almacenar la info del subproceso y el canal gRPC de cada sesión
        self.sessions = {}

    def InitializeSession(self, request, context):
        session_id = str(uuid.uuid4())
        port = get_free_port()

        print(f"[MASTER] Iniciando Worker para sesión {session_id} en el puerto {port}...")
        
        # Levantamos el proceso
        process = subprocess.Popen([sys.executable, "worker.py", str(port)])
        
        # Creamos el canal
        channel = grpc.insecure_channel(f'localhost:{port}')
        
        # Bloqueamos hasta que el worker responda
        print(f"[MASTER] Esperando a que TensorFlow/Sionna carguen en el Worker (puerto {port})...")
        try:
            grpc.channel_ready_future(channel).result(timeout=120)
            print(f"[MASTER] Conexión establecida con éxito en el puerto {port}.")
        except grpc.FutureTimeoutError:
            process.kill()
            raise Exception("Timeout: El Worker tardó demasiado en iniciar.")

        stub = ris_pb2_grpc.RISServiceStub(channel)

        self.sessions[session_id] = {
            "process": process,
            "channel": channel,
            "stub": stub,
            "port": port
        }

        # Inicializamos la escena vacía dentro del worker
        stub.InitializeSession(request)

        return ris_pb2.InitializeSessionReturn(session_id=session_id)

    # Funciones proxy: Reenvían la petición al stub (worker) correspondiente
    def _get_stub(self, session_id):
        if session_id not in self.sessions:
            raise Exception("Invalid or expired session.")
        return self.sessions[session_id]["stub"]

    def LoadScene(self, request, context):
        return self._get_stub(request.session_id).LoadScene(request)

    def CreateRIS(self, request, context):
        return self._get_stub(request.session_id).CreateRIS(request)

    def EditRIS(self, request, context):
        return self._get_stub(request.session_id).EditRIS(request)

    def DeleteObject(self, request, context):
        return self._get_stub(request.session_id).DeleteObject(request)

    def ConfigurePlanarArrays(self, request, context):
        return self._get_stub(request.session_id).ConfigurePlanarArrays(request)

    def CreateRadioObject(self, request, context):
        return self._get_stub(request.session_id).CreateRadioObject(request)

    def EditRadioObject(self, request, context):
        return self._get_stub(request.session_id).EditRadioObject(request)

    def UpdatePosition(self, request, context):
        return self._get_stub(request.session_id).UpdatePosition(request)

    def ComputeRayTracing(self, request, context):
        return self._get_stub(request.session_id).ComputeRayTracing(request)
    
    def ComputeCoverageMap(self, request, context):
        return self._get_stub(request.session_id).ComputeCoverageMap(request)

    def SaveSession(self, request, context):
        return self._get_stub(request.session_id).SaveSession(request)

    def LoadSession(self, request, context):
        return self._get_stub(request.session_id).LoadSession(request)


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    ris_pb2_grpc.add_RISServiceServicer_to_server(RISMasterServicer(), server)

    server.add_insecure_port('[::]:50051')
    server.start()
    print("Master gRPC Router escuchando en el puerto 50051.")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()