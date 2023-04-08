<script setup>
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
    background-color: #e6e;
}
</style>
