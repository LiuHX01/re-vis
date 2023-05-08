<script setup>
import {onMounted, ref} from "vue";
import {DataAdaptor, EventAdaptor} from "./tools/Adaptor.js";
import MapVis from "./components/MapVis.vue";
import MotionRugs from "./components/MotionRugs.vue";
import csv from "csvtojson";
import hotkeys from 'hotkeys-js';
import {ElMessage} from 'element-plus'

const usedData = "I24"

let groupedData = {}; // 根据TrackID分组的数据，保证组内数据是时间有序的，key为TrackID，value为其他属性
let movers = []; // 所有的移动物体，此处为TrackID列表
let nowFrame = 0; // 当前帧数

const fetchData = async () => {
    for (let i = 0; i < 3 + 11; i++) {
        let url
        if (usedData === "I24") {
            url = `https://raw.githubusercontent.com/LiuHX01/DataSets/main/cutReduce${i}.csv`
        } else {
            if (i < 3) {
                url = `https://raw.githubusercontent.com/LiuHX01/DataSets/main/ship_data_${i}.csv`
            } else if (i >= 3 && i < 3 + 11) {
                url = `https://raw.githubusercontent.com/LiuHX01/DataSets/main/uav_data_${i - 3}.csv`
            }
        }
        const response = await fetch(url);
        const text = await response.text();
        let jsonObj = await csv().fromString(text);
        for (let [index, item] of jsonObj.entries()) {
            item.TrackID = i;
            item.Velocity = parseFloat(item.Velocity);
            item.Acceleration = parseFloat(item.Acceleration);
            item.LongitudeGPS = parseFloat(item.LongitudeGPS);
            item.LatitudeGPS = parseFloat(item.LatitudeGPS);
            // item.Type = parseInt(item.Type);
            item.Type = 1
        }
        movers.push(i);
        groupedData[i] = jsonObj;
        if (i === 3 + 11 - 1) {
            ElMessage('数据加载完毕')
        }
        console.log(`第${i + 1}个文件已经加载完毕`)
    }
};
fetchData()

let pauseFlag = false;
const togglePauseFlag = () => {
    pauseFlag = !pauseFlag;
    if (pauseFlag) {
        console.log("pause");
        ElMessage('暂停')
    } else {
        console.log("resume");
        ElMessage('继续')
    }
};
hotkeys('t', togglePauseFlag);

// Event : 36.073803, -86.694318
// 100(交通拥堵): 36.109598, -86.722051

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
            if (pauseFlag || Object.keys(groupedData).length !== 11 + 3) {
                return;
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

                    if (nowFrame === 15) {
                        DataAdaptor.Emitter({
                            rank: 0.6,
                            img: 'e0.jpeg',
                            msg: '交通拥堵',
                            pos: '高架环路',
                            loc: [36.110025, -86.722168],
                            type: "Event"
                        });
                    } else if (nowFrame === 24) {
                        DataAdaptor.Emitter({
                            rank: 2.9,
                            img: 'e1.jpeg',
                            msg: '物体燃烧',
                            pos: '小区内部',
                            loc: [36.10852, -86.721419],
                            type: "Event"
                        });
                    } else if (nowFrame === 35) {
                        DataAdaptor.Emitter({
                            rank: 1.2,
                            img: 'e2.jpeg',
                            msg: '公路破坏',
                            pos: '高速公路',
                            loc: [36.106504, -86.719403],
                            type: "Event"
                        });
                    }


                    nowFrame++;
                }
            }
        }, 0)

    }, 500);
});

</script>

<template>
    <div id="app" @keyup.p="togglePauseFlag">
        <MapVis></MapVis>
    </div>
</template>

<style>
</style>
