<script setup>
import { ref, onMounted } from "vue";
import { PixelAdaptor } from "../tools/Adaptor";

import resizeImageData from "resize-image-data";

const props = defineProps(["id", "strategy", "feature"]);

const cItem = {
    canvas: null,
    ctx: null,
};

const resizeScale = 4;

onMounted(() => {
    cItem.canvas = document.getElementById(props.id);
    cItem.ctx = cItem.canvas.getContext("2d");
    cItem.canvas.width = 0;
    cItem.canvas.height = 0;

    PixelAdaptor.Listener((data) => {
        const { strategy, feature, imgData } = data;
        if (strategy === props.strategy && feature === props.feature) {
            // 将imgData扩大到canvas的大小
            const afterImgData = resizeImageData(imgData, imgData.width * resizeScale, imgData.height * resizeScale);
            cItem.canvas.width = afterImgData.width;
            cItem.canvas.height = afterImgData.height;
            cItem.ctx.putImageData(afterImgData, 0, 0);
        }
    });
});
</script>

<template>
    <div class="pixel-container">
        <canvas :id="props.id"></canvas>
    </div>
</template>

<style scoped>
.pixel-container {
    width: 100%;
    height: 100%;
}
</style>
