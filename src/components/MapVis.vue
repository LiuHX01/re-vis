<script setup>
import { ref, onMounted, reactive } from "vue";
import { DataAdaptor } from "../tools/Adaptor.js";

import "leaflet/dist/leaflet.css";
import * as L from "leaflet";
import "leaflet-switch-basemap/src/L.switchBasemap.js";
import "leaflet-switch-basemap/src/L.switchBasemap.css";
import "leaflet.motion/dist/leaflet.motion.js";
import "leaflet-sidebar-v2/js/leaflet-sidebar.js";
import "leaflet-sidebar-v2/css/leaflet-sidebar.css";

/**
 * - 约定坐标经纬度以[lat, lng]的形式存储和表示
 */

// ========================= 地图自身 =========================
let map = null;

class MyMap {
    constructor() {
        this.zoom = 15;
        this.maxZoom = 17;
        this.minZoom = 12;
        this.nowCenter = [38.99670731327896, 117.30619668960573];
    }

    createMap() {
        map = L.map("map", {
            preferCanvas: true,
            renderer: L.canvas(),
            attributionControl: false,
            scrollWheelZoom: false,
        }).setView(this.nowCenter, this.zoom);

        map.zoomControl.setPosition("topright");

        // L.control.scale({ maxWidth: 100, imperial: false }).addTo(map);

        // 点击输出经纬度
        map.on("click", (e) => {
            console.log(e.latlng, map.getCenter(), map.getZoom());
        });
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
        this.baseMapsSwitcherPlugin();

        this.sidebarPlugin();
        this.toCenterPlugin();
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
            { position: "bottomright" }
        ).addTo(map);
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
        L.control.resetCenter({ position: "topright" }).addTo(map);
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
        this.nowFrame = 0;
        this.locList = [];
        this.velocityList = [];
        this.accelerationList = [];
        this.prevListLength = 0;
        this.id = id;
        this.marker = null;
        this.seq = null;
        this.moveDuration = 510;
    }

    newLoc(loc, frameNum, velocity, acceleration) {
        this.nowFrame = frameNum;
        this.locList[frameNum] = loc;
        this.velocityList[frameNum] = velocity;
        this.accelerationList[frameNum] = acceleration;
        if (this.locList.length >= 2) {
            if (!this.locList[this.locList.length - 1] || !this.locList[this.locList.length - 2]) {
                return;
            }
        }

        // 为了保证及时，如果上一个路径没有画完，下一个路径数据就来了，就直接画下一个路径
        // 另外为了避免乱序到达，如果当前路径数据的帧号比上一个路径数据的帧号小，就不画
        this.marker = L.motion.polyline(
            [this.locList[this.locList.length - 2], this.locList[this.locList.length - 1]],
            {
                color: "transparent",
            },
            {
                auto: true,
                duration: this.moveDuration,
            },
            {
                removeOnEnd: true,
                icon: L.icon({
                    iconUrl: "/ugv.svg",
                    iconSize: [16, 16],
                }),
            }
        );
        if (this.locList.length == 2 && this.locList.length != this.prevListLength) {
            this.seq = L.motion.seq([this.marker]).addTo(map);
        } else if (this.locList.length > 2 && this.locList.length != this.prevListLength) {
            this.seq.addLayer(this.marker, true);
        }
    }
}

// ========================= 发现事件 =========================
let events = reactive([]);
class Event {}

// ========================= 数据监听 =========================
onMounted(() => {
    myMap.createMap();
    mapController = new MapController();
    DataAdaptor.Listener((data) => {
        const { fData, fNum } = data;
        fData.forEach((item) => {
            const { TrackID, LatitudeGPS, LongitudeGPS, Velocity, Acceleration } = item;
            const loc = [LatitudeGPS, LongitudeGPS];
            if (TrackID in movers) {
                movers[TrackID].newLoc(loc, fNum, Velocity, Acceleration);
            } else {
                movers[TrackID] = new Mover(TrackID);
                movers[TrackID].newLoc(loc, fNum, Velocity, Acceleration);
            }
        });
    });
});

const findMover = (id) => {
    console.log("findMover", id);

    myMap.nowCenter = movers[id].locList[movers[id].nowFrame];
    map.flyTo(movers[id].locList[movers[id].nowFrame]);
};
</script>

<template>
    <div id="map">
        <div id="sidebar" class="leaflet-sidebar collapsed">
            <div class="leaflet-sidebar-tabs">
                <ul role="tablist">
                    <li>
                        <a href="#allMovers" role="tab" class="tab-icon">
                            <img src="/watching.svg" width="30" height="40" />
                        </a>
                    </li>
                    <li>
                        <a href="#allEvents" role="tab" class="tab-icon">
                            <img src="/alert.svg" width="30" height="40" />
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
                                        <img src="/position-white.svg" width="14" height="14" />
                                    </el-button>
                                </div>
                            </template>
                            <el-descriptions direction="vertical" :column="3" border>
                                <el-descriptions-item label="当前帧号">{{ value.nowFrame }}</el-descriptions-item>
                                <el-descriptions-item label="当前速度">
                                    {{ parseFloat(value.velocityList[value.nowFrame]).toFixed(2) }} km/h
                                </el-descriptions-item>
                                <el-descriptions-item label="当前加速度">
                                    {{ parseFloat(value.accelerationList[value.nowFrame]).toFixed(2) }} m/s²
                                </el-descriptions-item>
                                <el-descriptions-item label="当前坐标">
                                    {{ parseFloat(value.locList[value.nowFrame][0]).toFixed(6) }},
                                    {{ parseFloat(value.locList[value.nowFrame][1]).toFixed(6) }}
                                </el-descriptions-item>
                            </el-descriptions>
                        </el-card>
                    </div>
                </div>

                <div class="leaflet-sidebar-pane" id="allEvents">
                    <h1 class="leaflet-sidebar-header">事件监视</h1>
                    <div v-if="events.length === 0">
                        <el-empty description="暂无事件"></el-empty>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style>
#map {
    width: 100%;
    height: calc(100vh - 57px);
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
    padding: 0px;
}
</style>
