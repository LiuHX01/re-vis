<script setup>
import { ref, onMounted } from "vue";
import { DataAdaptor } from "../tools/Adaptor.js";

import resizeImageData from "resize-image-data";

/**
 * : 经过测试，速度+希尔伯特曲线索引的策略是最直观的，因此在这里只展示这一种pixels
 */

let pixelContainerRef = ref(null);

const cItem = {
    canvas: null,
    ctx: null,
};
const resizeScale = 4;

let strategys = ["HilbertOrder"]; // 策略列表
let features = ["Velocity"]; // 特征列表

const pixelWorker = new Worker(new URL("./PixelWorker.js", import.meta.url));

onMounted(() => {
    cItem.canvas = document.getElementById("canvas");
    cItem.ctx = cItem.canvas.getContext("2d");
    cItem.canvas.width = pixelContainerRef.value.clientWidth;
    cItem.canvas.height = 56;

    DataAdaptor.Listener((data) => {
        const { fData, fNum } = data;
        pixelWorker.postMessage({ fData: fData, fNum: fNum, width: cItem.canvas.width });
    });
    pixelWorker.onmessage = (e) => {
        const { strategy, feature, imgData } = e.data;
        const afterImgData = resizeImageData(imgData, imgData.width * resizeScale, imgData.height * resizeScale);
        cItem.ctx.putImageData(afterImgData, 0, 0);
    };
});
</script>

<template>
    <div class="motionrugs-container" ref="pixelContainerRef">
        <canvas id="canvas"></canvas>
    </div>
</template>

<style scoped>
.motionrugs-container {
    width: 100%;
    background-color: #fafaf8;
}
</style>
