import mitt from "mitt";

const emitter = mitt();

class Adaptor {
    constructor(namespace) {
        this.namespace = namespace;
    }

    Emitter(data) {
        emitter.emit(this.namespace, data);
    }

    Listener(callback) {
        emitter.on(this.namespace, (data) => callback(data));
    }
}

const DataAdaptor = new Adaptor("data");
const PixelAdaptor = new Adaptor("pixel");
const EventAdaptor = new Adaptor("event");

export { DataAdaptor, PixelAdaptor, EventAdaptor };
