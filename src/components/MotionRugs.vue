<script setup>
import { ref, onMounted, nextTick } from "vue";
import { DataAdaptor, PixelAdaptor, EventAdaptor } from "../tools/Adaptor.js";

import Pixel from "./Pixel.vue";

let pixelContainerRef = ref(null);

let strategys = ["HilbertOrder", "zOrder"]; // 策略列表
let en2cnStrategys = ["希尔伯特曲线", "Z曲线"]; // 策略列表
let features = ["Velocity", "Acceleration"]; // 特征列表
let en2cnFeatures = ["速度", "加速度"]; // 特征列表

const pixelWorker = new Worker(new URL("./PixelWorker.js", import.meta.url));

onMounted(() => {
    DataAdaptor.Listener((data) => {
        const { fData, fNum } = data;
        pixelWorker.postMessage({ fData, fNum, eType: "newData" });
    });
    pixelWorker.onmessage = (e) => {
        const { strategy, feature, imgData } = e.data;
        PixelAdaptor.Emitter({ strategy, feature, imgData });
    };

    EventAdaptor.Listener((msg) => {
        if (msg === "resetMaxWidth") {
            nextTick(() => {
                pixelWorker.postMessage({ fData: pixelContainerRef.value[0].clientWidth - 10 - 10, fNum: null, eType: "resetMaxWidth" });
            });
        }
    });
});
</script>

<template>
    <div class="motionrugs-container">
        <Pixel></Pixel>
    </div>
</template>

<style scoped>
.motionrugs-container {
    width: 100%;
    background-color: #fafaf8;
}
</style>
