import { RISServiceClient } from './grpc/ris_grpc_web_pb.js';
import { 
    EmptyParameters, LoadSceneParameters, NewRISParameters, 
    EditRISParameters, DeleteObjectParameters, ConfigurePlanarArraysParameters,
    NewRadioObjectParameters, EditRadioObjectParameters, UpdatePositionParameters, 
    RayTracingParameters, CoverageMapParameters, SaveSessionParameters, 
    LoadSessionParameters 
} from './grpc/ris_pb.js';

const client = new RISServiceClient('http://localhost:8080');

export const api = {
    initializeSession: () => {
        return new Promise((resolve, reject) => {
            client.initializeSession(new EmptyParameters(), {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },
    
    loadScene: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.loadScene(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    createRIS: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.createRIS(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    editRIS: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.editRIS(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    deleteObject: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.deleteObject(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    configurePlanarArrays: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.configurePlanarArrays(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    createRadioObject: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.createRadioObject(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    editRadioObject: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.editRadioObject(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    updatePosition: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.updatePosition(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    computeRayTracing: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.computeRayTracing(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    computeCoverageMap: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.computeCoverageMap(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    saveSession: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.saveSession(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    },

    loadSession: (requestParams) => {
        return new Promise((resolve, reject) => {
            client.loadSession(requestParams, {}, (err, response) => {
                if (err) reject(err); else resolve(response);
            });
        });
    }
};