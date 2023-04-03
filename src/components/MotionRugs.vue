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
        <div v-for="item in strategys.length * features.length" :key="item" class="scrollbar-item">
            <div class="pixel-name">
                <span class="feature-name">{{ en2cnFeatures[(item - 1) % features.length] }}</span>
                <span class="strategy-name">{{ en2cnStrategys[Math.round((item - 1) / (strategys.length * features.length))] }}</span>
            </div>
            <div class="pixel-item" ref="pixelContainerRef">
                <Pixel
                    :id="item"
                    :strategy="strategys[Math.round((item - 1) / (strategys.length * features.length))]"
                    :feature="features[(item - 1) % features.length]"
                >
                </Pixel>
            </div>
        </div>
    </div>
    <!-- </el-scrollbar> -->
</template>

<style scoped>
.motionrugs-container {
    height: calc(100vh - 41px);
    width: 100%;
    background-color: #fafaf8;
}

.scrollbar-item {
    margin: 10px;
    border-radius: 4px;
    height: 116px;
    background: var(--el-color-info-light-9);
    color: var(--el-color-primary-dark-2);
}

.pixel-name {
    padding-left: 10px;
    padding-right: 10px;
    font-size: 30px;
    font-weight: bold;
}

.strategy-name {
    float: right;
}

.pixel-item {
    padding: 10px;
    height: 56px;
    border-top: 1px solid var(--el-color-primary);
}

@media screen and (max-width: 849px) {
    .pixel-name {
        font-size: 20px;
    }
}

@media screen and (max-width: 600px) {
    .strategy-name {
        float: none;
        display: block;
    }
    .scrollbar-item {
        height: 156px;
    }
}
</style>
