<script setup>
import {onMounted} from "vue";
import {DataAdaptor, EventAdaptor} from "./tools/Adaptor.js";
import MapVis from "./components/MapVis.vue";
import csv from "csvtojson";
import hotkeys from 'hotkeys-js';
import {Config} from "./tools/config.js";

const usedData = Config.DataSet
const fileNum = Config.MoverNum

let groupedData = {}; // 根据TrackID分组的数据，保证组内数据是时间有序的，key为TrackID，value为其他属性
let movers = []; // 所有的移动物体，此处为TrackID列表
let nowFrame = 0; // 当前帧数

const fetchData = async () => {
    for (let i = 0; i < fileNum; i++) {
        let url
        if (usedData === "I24") {
            url = `https://raw.githubusercontent.com/LiuHX01/DataSets/main/cut${i}.csv`
        } else if (usedData === "ZTD") {
            url = `https://raw.githubusercontent.com/LiuHX01/DataSets/main/NewDataSet/newData${i}.csv`
        }

        const response = await fetch(url);
        const text = await response.text();
        let jsonObj = await csv().fromString(text);
        for (let [index, item] of jsonObj.entries()) {
            item.TrackID = i;
            item.Velocity = parseFloat(item.Velocity)
            item.Acceleration = parseFloat(item.Acceleration)
            item.LongitudeGPS = parseFloat(item.LongitudeGPS)
            item.LatitudeGPS = parseFloat(item.LatitudeGPS)
            item.Type = parseInt(item.Type);
        }
        movers.push(i);
        groupedData[i] = jsonObj;

        console.log(`第${i + 1}个文件已经加载完毕`)
    }
};
fetchData()

let pauseFlag = !Config.startImmediately;
const togglePauseFlag = () => {
    pauseFlag = !pauseFlag;
};
hotkeys('t', togglePauseFlag);

let oneSendFlag = false;
const setOneSend = () => {
    oneSendFlag = true;
}
hotkeys('y', setOneSend)

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
        setTimeout(() => {
            if (pauseFlag || Object.keys(groupedData).length !== fileNum) {
                if (oneSendFlag) {
                    oneSendFlag = false;
                } else {
                    return;
                }
            }
            if (groupedData !== []) {
                const frameData = [];
                movers.forEach((mover) => {
                    if (nowFrame >= groupedData[mover].length) {
                        frameData.push({
                            TrackID: mover,
                            Time: -11,
                            LongitudeGPS: -1,
                            LatitudeGPS: -1,
                            Velocity: -1,
                            Acceleration: -1
                        });
                        return;
                    }
                    let data = groupedData[mover][nowFrame];

                    frameData.push(data);
                });
                if (frameData.length === 0) {
                    console.log("数据发送完毕")
                } else {
                    DataAdaptor.Emitter({fData: frameData, fNum: nowFrame, type: "Trajectory"});
                    nowFrame += 1;
                }
            }
        }, 0)

    }, Config.Duration);
});

const es = [{
    rank: 0.6,
    img: 'e0.jpeg',
    msg: '交通拥堵',
    pos: '高架环路',
    loc: [36.110025, -86.722168],
    type: "Event"
}, {
    rank: 2.9,
    img: 'e1.jpeg',
    msg: '物体燃烧',
    pos: '小区内部',
    loc: [36.10852, -86.721419],
    type: "Event"
}, {
    rank: 1.2,
    img: 'e2.jpeg',
    msg: '公路破坏',
    pos: '高速公路',
    loc: [36.106504, -86.719403],
    type: "Event"
}]
const sendEvent = () => {
    const e = es.shift();
    if (e) {
        DataAdaptor.Emitter(e);
    }
}

hotkeys('ctrl+e', sendEvent);
</script>

<template>
    <div id="app">
        <MapVis></MapVis>
    </div>
</template>

<style>
</style>
