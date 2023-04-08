<script setup>
/**
 * TODO: 真实数据和此处应该有所差别，需要进一步确认，具体体现在
 * ! 得到的数据种类，除了经纬度等是否还有图片、视频等更加复杂的数据
 * ! 得到的数据是否保证有序、不重复、不缺失，如果能做到，是单个能做到还是相互之间都能做到
 * ! 得到的数据是单个mover还是打包了的所有mover的数据
 * ! 能够支持请求的频繁程度，以及获得的数据是否能够保证实时性
 */

import { onMounted, ref } from "vue";
import { DataAdaptor, EventAdaptor } from "./tools/Adaptor.js";
import MapVis from "./components/MapVis.vue";
import MotionRugs from "./components/MotionRugs.vue";
import csv from "csvtojson";

let groupedData = {}; // 根据TrackID分组的数据，保证组内数据是时间有序的，key为TrackID，value为其他属性
let movers = []; // 所有的移动物体，此处为TrackID列表
let nowFrame = 0; // 当前帧数

const rawDataURL = "https://raw.githubusercontent.com/LiuHX01/DataSets/main/merge_500.csv";

const fetchRawData = async (URL) => {
    const response = await fetch(URL);
    const text = await response.text();
    const jsonObj = await csv().fromString(text);

    jsonObj.forEach((item) => {
        const { TrackID } = item;
        if (!movers.includes(TrackID)) {
            movers.push(TrackID);
        }
        item.LongitudeGPS = parseFloat(item.LongitudeGPS);
        item.LatitudeGPS = parseFloat(item.LatitudeGPS);
        item.Velocity = parseFloat(item.Velocity);
        item.Acceleration = parseFloat(item.Acceleration);
        TrackID in groupedData ? groupedData[TrackID].push(item) : (groupedData[TrackID] = [item]);
    });
};
fetchRawData(rawDataURL);

onMounted(() => {
    /*
        模拟流式数据，每隔一秒发送一帧数据
        每一次发送的数据格式:
        [
            {Time: ..., ... TrackID: ..., ...},
            {Time: ..., ... TrackID: ..., ...},
            ...
        ]
    */
    setInterval(() => {
        if (groupedData !== []) {
            const frameData = [];
            movers.forEach((mover) => {
                if (nowFrame >= groupedData[mover].length) {
                    return;
                }
                const data = groupedData[mover][nowFrame];
                frameData.push(data);
            });
            if (frameData.length == 0) {
                return;
            } else {
                DataAdaptor.Emitter({ fData: frameData, fNum: nowFrame });
                nowFrame++;
            }
        }
    }, 500);
});
</script>

<template>
    <div id="app">
        <MapVis></MapVis>
        <div class="divider"></div>
        <MotionRugs></MotionRugs>
    </div>
</template>

<style>
.divider {
    height: 1px;
    width: 100%;
    background-color: #d5dadc;
}
</style>
