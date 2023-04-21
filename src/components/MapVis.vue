<script setup>
import {onMounted, reactive, ref} from "vue";
import {DataAdaptor} from "../tools/Adaptor.js";
import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import "leaflet-switch-basemap/src/L.switchBasemap.js";
import "leaflet-switch-basemap/src/L.switchBasemap.css";
import "leaflet.motion/dist/leaflet.motion.js";
import "leaflet-sidebar-v2/js/leaflet-sidebar.js";
import "leaflet-sidebar-v2/css/leaflet-sidebar.css";
import resizeImageData from "resize-image-data";

// ========================= 地图自身 =========================
let map = null;

class MyMap {
    constructor() {
        this.zoom = 15;
        this.maxZoom = 17;
        this.minZoom = 12;
        this.nowCenter = [36.055813, -86.673996];
    }

    createMap() {
        map = L.map("map", {
            preferCanvas: true,
            renderer: L.canvas(),
            attributionControl: false,
            scrollWheelZoom: false,
        }).setView(this.nowCenter, this.zoom);

        map.zoomControl.setPosition("topright");

        this.baseMapsSwitcherPlugin()

        // 点击输出经纬度
        map.on("click", (e) => {
            console.log(`click:${e.latlng}, center:${map.getCenter()}`);
        });
    }

    baseMapsSwitcherPlugin() {
        new L.basemapsSwitcher(
            [
                {
                    layer: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
                        zoom: this.zoom,
                        maxZoom: this.maxZoom,
                        minZoom: this.minZoom,
                    }).addTo(map),
                    icon: "/light.png",
                    name: "Light",
                },
                {
                    layer: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
                        zoom: this.zoom,
                        maxZoom: this.maxZoom,
                        minZoom: this.minZoom,
                    }),
                    icon: "/dark.png",
                    name: "Dark",
                },
                {
                    layer: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
                        zoom: this.zoom,
                        maxZoom: this.maxZoom,
                        minZoom: this.minZoom,
                    }),
                    icon: "/voyager.png",
                    name: "Voyager",
                },
            ],
            {position: "bottomright"}
        ).addTo(map);
    }

    toCenter() {
        let latSum = 0;
        let lngSum = 0;
        let count = 0;
        for (const key in movers) {
            const mover = movers[key];
            if (mover.marker) {
                const loc = mover.marker.getMarkers()[0].getLatLng();
                latSum += loc.lat;
                lngSum += loc.lng;
                count++;
            }
        }
        if (count > 0) {
            this.nowCenter = [latSum / count, lngSum / count];
        }
        map.panTo(this.nowCenter, map.getZoom());
    }
}

let myMap = new MyMap();

// ========================= 地图控制 =========================
let mapController = null;

class MapController {
    constructor() {
        this.sidebarPlugin();
        this.toCenterPlugin();
    }


    toCenterPlugin() {
        L.Control.ResetCenter = L.Control.extend({
            options: {
                position: "topright",
            },
            initialize: function (options) {
                L.Util.extend(this.options, options);
            },
            onAdd: function (map) {
                const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom");
                container.style.backgroundColor = "white";
                container.style.backgroundRepeat = "no-repeat";
                container.style.backgroundPosition = "center";
                container.style.backgroundImage = "url(/position.svg)";
                container.style.backgroundSize = "22px 22px";
                container.style.width = "30px";
                container.style.height = "30px";
                container.onmouseover = () => {
                    container.style.backgroundColor = "#f4f4f4";
                };
                container.onmouseout = () => {
                    container.style.backgroundColor = "white";
                };

                container.onclick = () => {
                    myMap.toCenter();
                };
                return container;
            },
        });
        L.control.resetCenter = function (opts) {
            return new L.Control.ResetCenter(opts);
        };
        L.control.resetCenter({position: "topright"}).addTo(map);
    }

    sidebarPlugin() {
        L.control
            .sidebar({
                autopan: true,
                container: "sidebar",
            })
            .addTo(map);
    }
}

// ========================= 移动目标 =========================
let movers = reactive({}); // key为TrackID，value为Mover对象
class Mover {
    constructor(id) {
        this.startRealFrame = 0;
        this.frameLength = 2000;

        // startRealFrame 到 (startRealFrame + frameLength) 范围内的所有数据
        this.locList = [];
        this.velocityList = [];
        this.accelerationList = [];

        this.id = id;
        this.marker = null;
        this.icon = L.icon({
            iconUrl: "/ugv.svg",
            iconSize: [16, 16],
        });
        this.moveDuration = 500;
    }

    setFrameLength(newFrameLength) {
        if (newFrameLength < this.frameLength) {
            this.locList = this.locList.slice(0, newFrameLength);
            this.velocityList = this.velocityList.slice(0, newFrameLength);
            this.accelerationList = this.accelerationList.slice(0, newFrameLength);
        }
        this.frameLength = newFrameLength;
        console.log(`id: ${this.id}, setFrameLength: ${this.frameLength}`);
    }

    /**
     * 当接收到新的数据时，调用此方法，保证数据量在一定的范围内，并且更新marker，[由App.vue保证到这里的数据都是按序的]
     * @param loc {[number, number]} 位置
     * @param frameNum {number} 帧号
     * @param velocity {number} 速度
     * @param acceleration {number} 加速度
     */
    newData(loc, frameNum, velocity, acceleration) {
        this.locList.push(loc);
        this.velocityList.push(velocity);
        this.accelerationList.push(acceleration);
        if (this.locList.length > this.frameLength) {
            this.locList.shift();
            this.velocityList.shift();
            this.accelerationList.shift();
            this.startRealFrame++;
        }

        if (this.locList.length >= 2) {
            this.updateMarker();
        }
    }

    /**
     * 更新marker
     */
    updateMarker() {
        if (this.marker) {
            this.marker.remove();
        }

        this.marker = L.motion.polyline(
            [this.locList[this.locList.length - 2], this.locList[this.locList.length - 1]],
            {
                color: "transparent",
            },
            {
                auto: true,
                duration: this.moveDuration,
                easing: L.Motion.Ease.swing,
            },
            {
                removeOnEnd: false,
                showMarker: true,
                icon: this.icon,
            }
        );

        this.marker.addTo(map);
    }

    changeIcon(iconName) {
        if (this.marker) {

            this.marker.getMarkers()[0].setIcon(L.icon({
                iconUrl: iconName,
                iconSize: [24, 24],
            }));
        }
    }
}


// ========================= MotionRugs =========================
class MotionRugs {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.resizeScale = 6;
        this.features = ["Velocity"]; // 特征列表
        this.strategies = ["HilbertOrder"]; // 策略列表

        this.rawImageData = null;
        this.resizedImageData = null;
        this.orderedData = null;

        this.hasMask = false;
        this.maskID = -1;
    }

    updateData(orderedData, rawImageData) {
        this.orderedData = orderedData;
        this.rawImageData = rawImageData;
        this.resizedImageData = resizeImageData(this.rawImageData, this.rawImageData.width * motionRugs.resizeScale, this.rawImageData.height * motionRugs.resizeScale)
        this.drawBase();
        this.drawSingleMask();
    }

    drawBase() {
        this.ctx.putImageData(this.resizedImageData, 0, 0);
    }

    clearMask() {
        this.hasMask = false;
        this.drawBase();
    }
    clickAndMask(id, frame) {
        if (frame < 0 || frame >= this.orderedData.length) {
            clearMask();
            return;
        }
        if (this.hasMask) {
            this.drawBase();
        }
        this.hasMask = true;
        this.maskID = this.orderedData[frame][id].TrackID;
        this.drawSingleMask()

        movers[this.maskID].changeIcon("/tju_logo.png");
        findMover(this.maskID);
    }


    drawSingleMask() {
        if (!this.hasMask) {
            return;
        }

        for (let x = 0; x < this.orderedData.length; x++) {
            for (let y = 0; y < this.orderedData[x].length; y++) {
                if (this.orderedData[x][y].TrackID === this.maskID) {
                    this.ctx.fillStyle = "rgb(0,0,0)";
                    this.ctx.fillRect(x * motionRugs.resizeScale, y * motionRugs.resizeScale, motionRugs.resizeScale, motionRugs.resizeScale);
                }
            }
        }
    }
}

let motionRugs = new MotionRugs();
const pixelWorker = new Worker(new URL("./PixelWorker.js", import.meta.url));
let pixelContainerRef = ref(null);
// ========================= 数据监听 =========================
onMounted(() => {
    myMap.createMap();
    mapController = new MapController();

    DataAdaptor.Listener((data) => {
        const {fData, fNum} = data;

        fData.forEach((item) => {
            const {Time, TrackID, LatitudeGPS, LongitudeGPS, Velocity, Acceleration} = item;
            const loc = [LatitudeGPS, LongitudeGPS];
            if (!(TrackID in movers)) {
                movers[TrackID] = new Mover(TrackID);
                movers[TrackID].setFrameLength(pixelContainerRef.value.clientWidth);
            }
            if (Time !== -1) {
                movers[TrackID].newData(loc, fNum, Velocity, Acceleration)
                pixelWorker.postMessage({fData: fData, fNum: fNum, width: motionRugs.canvas.width});
            }
        });
    });

    motionRugs.canvas = document.getElementById("canvas");
    motionRugs.ctx = motionRugs.canvas.getContext("2d");
    motionRugs.canvas.width = pixelContainerRef.value.clientWidth;
    motionRugs.canvas.height = 84;

    pixelWorker.onmessage = (e) => {
        const {strategy, feature, imgData, orderedData} = e.data;
        motionRugs.updateData(orderedData, imgData);
    };
});

const findMover = (id) => {
    console.log("findMover", id);

    myMap.nowCenter = movers[id].locList[movers[id].locList.length - 1];
    map.panTo(movers[id].locList[movers[id].locList.length - 1]);
};

const clkMotionRugs = (e) => {
    const x = e.offsetX;
    const y = e.offsetY;
    const frameNum = Math.floor(x / motionRugs.resizeScale);
    const trackID = Math.floor(y / motionRugs.resizeScale);
    motionRugs.clickAndMask(trackID, frameNum);
    console.log(`clkMotionRugs: frameNum: ${frameNum}, trackID: ${trackID}, x: ${x}, y: ${y}`);
}

const clearMask = () => {
    motionRugs.clearMask();
}
</script>

<template>
    <div id="map">
        <div id="sidebar" class="leaflet-sidebar collapsed">
            <div class="leaflet-sidebar-tabs">
                <ul role="tablist">
                    <li>
                        <a href="#allMovers" role="tab" class="tab-icon">
                            <img src="/watching.svg" width="30" height="40" alt=""/>
                        </a>
                    </li>
                    <li>
                        <a href="#allEvents" role="tab" class="tab-icon">
                            <img src="/alert.svg" width="30" height="40" alt=""/>
                        </a>
                    </li>
                </ul>
            </div>
            <div class="leaflet-sidebar-content">
                <div class="leaflet-sidebar-pane" id="allMovers">
                    <h1 class="leaflet-sidebar-header">设备监视</h1>
                    <div v-for="(value, key) of movers">
                        <el-card class="mover-card">
                            <template #header>
                                <div class="mover-card-header">
                                    <span class="mover-card-title"> 设备编号：{{ parseInt(key) }} </span>
                                    <el-button type="primary" @click="findMover(key)" circle>
                                        <img src="/position-white.svg" width="14" height="14" alt=""/>
                                    </el-button>
                                </div>
                            </template>
                            <el-descriptions direction="vertical" :column="3" :border="true">
                                <el-descriptions-item label="当前帧号">
                                    {{ value.locList.length - 1 + value.startRealFrame }}
                                </el-descriptions-item>
                                <el-descriptions-item label="当前速度">
                                    {{ parseFloat(value.velocityList[value.locList.length - 1]).toFixed(2) }} km/h
                                </el-descriptions-item>
                                <el-descriptions-item label="当前加速度">
                                    {{ parseFloat(value.accelerationList[value.locList.length - 1]).toFixed(2) }} m/s²
                                </el-descriptions-item>
                                <el-descriptions-item label="当前坐标">
                                    {{ parseFloat(value.locList[value.locList.length - 1][0]).toFixed(6) }},
                                    {{ parseFloat(value.locList[value.locList.length - 1][1]).toFixed(6) }}
                                </el-descriptions-item>
                            </el-descriptions>
                        </el-card>
                    </div>
                </div>

                <div class="leaflet-sidebar-pane" id="allEvents">
                    <h1 class="leaflet-sidebar-header">事件监视</h1>
                    <!--                    <div v-if="events.length === 0">-->
                    <!--                        <el-empty description="暂无事件"></el-empty>-->
                    <!--                    </div>-->
                </div>
            </div>
        </div>
    </div>

    <div class="motionrugs-container" ref="pixelContainerRef">
        <canvas id="canvas" @click="clkMotionRugs" @dblclick="clearMask"></canvas>
    </div>
</template>

<style>
#map {
    width: 100%;
    height: calc(100vh - 84px);
}

.mover-card {
    margin-bottom: 10px;
    margin-top: 10px;
}

.mover-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.mover-card-title {
    font-size: 20px;
    font-weight: bold;
}

.el-card > .el-card__body {
    padding: 0;
}

.motionrugs-container {
    width: 100%;
    background-color: #fafaf8;
}
</style>
