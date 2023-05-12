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
import 'leaflet-arrowheads';

import resizeImageData from "resize-image-data";
import {ElMessage} from 'element-plus'
import hotkeys from 'hotkeys-js';


let map = null;
let myMap = null;
let mapController = null;
let movers = reactive({}); // key为TrackID，value为Mover对象
let motionRugs = null;
let motionRugsDataset = null;
let pixelContainerRef = ref(null);
let eventProcessor = null;
let events = reactive([])
// let pathController = null;
let paths = reactive([{
    name: "默认路径",
    activeDevice: ["无人机"],
    length: 2,
    path: [[36.1115717, -86.7230948], [36.1112088, -86.7227895]],
    loopGo: false,
}])

const globalStrategy = "geoHashOrder";
const globalFeature = "Velocity";
const globalDebug = false;

// ========================= 地图自身 =========================


class MyMap {
    constructor() {
        this.zoom = 16;
        this.maxZoom = 20;
        this.minZoom = 10;
        this.nowCenter = [36.111582, -86.713157];
        // this.nowCenter = [38.996791, 117.306754]

        this.tmpMarker = null;

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
        // map.on("click", (e) => {
        //     console.log(`click:${e.latlng}, center:${map.getCenter()}`);
        //     ElMessage({
        //         message: `click:${e.latlng}, center:${map.getCenter()}`,
        //         type: 'success'
        //     })
        //     if (this.tmpMarker) {
        //         this.tmpMarker.remove();
        //     }
        //     this.tmpMarker = L.marker(e.latlng).addTo(map);
        // });
        // this.doSomeTest();

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

myMap = new MyMap();

// ========================= 地图控制 =========================


class MapController {
    constructor() {
        this.sidebar = null;
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
        this.sidebar = L.control
            .sidebar({
                autopan: true,
                container: "sidebar",
            })
            .addTo(map);
    }
}

// ========================= 移动目标 =========================

class Mover {
    constructor(id, type) {
        this.startRealFrame = 0;
        this.frameLength = 2000;

        // startRealFrame 到 (startRealFrame + frameLength) 范围内的所有数据
        this.locList = [];
        this.velocityList = [];
        this.accelerationList = [];

        this.id = id;
        this.marker = null;
        this.icon = (type === 0) ? L.icon({
            iconUrl: "/ship.svg",
            iconSize: [16, 16],
        }) : (type === 1 ? L.icon({
            iconUrl: "/uav.svg",
            iconSize: [16, 16],
        }) : L.icon({
            iconUrl: "/ugv.svg",
            iconSize: [16, 16],
        }));
        this.moveDuration = 200;

        this.hasPolyLines = false;
        this.maxPolyLineLength = 200;
        this.polyLines = [];

        this.hasStaticPolyLines = false;
        this.staticPolyLines = [];
        this.staticMarkers = [];

        this.colors = [
            "#313695",
            "#4575B4",
            "#74ADD1",
            "#ABD9E9",
            "#E0F3F8",
            "#FEE090",
            "#FDAE61",
            "#F46D43",
            "#D73027",
            "#A50026"
        ];

        this.debug = globalDebug
        this.openOffset = false;
        this.offsetLatitude = 0;
        this.offsetLongitude = 0;
        this.offsetLatitudeStep = 0.0000;
        this.offsetLongitudeStep = 0.0002;


    }

    setFrameLength(newFrameLength) {
        newFrameLength = Math.floor(newFrameLength / motionRugs.resizeScale)
        if (newFrameLength < this.frameLength) {
            this.locList = this.locList.slice(0, newFrameLength);
            this.velocityList = this.velocityList.slice(0, newFrameLength);
            this.accelerationList = this.accelerationList.slice(0, newFrameLength);
        }
        this.frameLength = newFrameLength;
    }

    /**
     * 当接收到新的数据时，调用此方法，保证数据量在一定的范围内，并且更新marker，[由App.vue保证到这里的数据都是按序的]
     * @param loc[lat,lng] {[number, number]} 位置
     * @param frameNum {number} 帧号
     * @param velocity {number} 速度
     * @param acceleration {number} 加速度
     */
    newData(loc, frameNum, velocity, acceleration) {

        if (loc[0] <= 36.109676 && loc[1] >= -86.721864 && this.debug) {
            if (this.openOffset) {
                loc[0] -= this.offsetLatitude;
                loc[1] -= this.offsetLongitude;

                this.offsetLatitude += this.offsetLatitudeStep;
                this.offsetLongitude += this.offsetLongitudeStep;
            } else {
                this.openOffset = true;
            }
        }

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
                easing: L.Motion.Ease.linear,
            },
            {
                removeOnEnd: false,
                showMarker: true,
                icon: this.icon,
            }
        );

        this.marker.addTo(map);

        this.drawPolyLines();
    }

    changeIcon(iconName) {
        if (this.marker) {

            this.marker.getMarkers()[0].setIcon(L.icon({
                iconUrl: iconName,
                iconSize: [24, 24],
            }));
        }
    }

    setHasPolyLines(hasPolyLines) {
        console.log(`id: ${this.id}, setHasPolyLines: ${hasPolyLines}`)
        this.hasPolyLines = hasPolyLines;
        if (!this.hasPolyLines) {
            this.clearPolyLines();
        } else {
            this.drawPolyLines();
        }
    }

    clearPolyLines() {
        // console.log(`id: ${this.id}, clearPolyLines`)
        this.polyLines.forEach(polyLine => {
            polyLine.remove();
        })
        this.polyLines = [];
    }

    drawPolyLines(from = 0, to = motionRugsDataset.orderedData.length - 1) {
        if (!this.hasPolyLines) {
            return;
        }
        this.clearPolyLines();
        for (let i = Math.max(from, motionRugsDataset.orderedData.length - 1 - this.maxPolyLineLength); i < to; i++) {
            // 找到这个id在motionRugs.orderedData[i]中的索引
            let idx;
            for (let tmp = 0; tmp < motionRugsDataset.orderedData[i].length; tmp++) {
                if (motionRugsDataset.orderedData[i][tmp].TrackID === this.id) {
                    idx = tmp;
                    break;
                }
            }

            const colorIdx = motionRugsDataset.orderedData[i][idx].colorIdx;
            const polyLine = L.polyline([this.locList[i], this.locList[i + 1]], {
                color: this.colors[colorIdx],
                weight: 4,
                // stroke: false,
            });
            polyLine.addTo(map);
            this.polyLines.push(polyLine);
        }
    }


    addStaticPolyLine(frame) {
        if (frame < 0 || frame >= this.locList.length - 1) {
            return;
        }
        // 找到这个id在motionRugs.orderedData[i]中的索引
        let idx;
        for (let tmp = 0; tmp < motionRugsDataset.orderedData[frame].length; tmp++) {
            if (motionRugsDataset.orderedData[frame][tmp].TrackID === this.id) {
                idx = tmp;
                break;
            }
        }

        const colorIdx = motionRugsDataset.orderedData[frame][idx].colorIdx;
        const polyLine = L.polyline([this.locList[frame], this.locList[frame + 1]], {
            color: this.colors[colorIdx],
            weight: 4,
            // stroke: false,
        }).arrowheads();
        polyLine.addTo(map);
        this.staticPolyLines.push(polyLine);

    }


    clearStatic() {
        this.staticPolyLines.forEach(polyLine => {
            polyLine.remove();
        })
        this.staticPolyLines = [];
        this.staticMarkers.forEach(marker => {
            marker.remove();
        })
        this.staticMarkers = [];
    }
}


// ========================= MotionRugs =========================
class MotionRugs {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.resizeScale = 6;

        this.feature = globalFeature;

        this.rawImageData = null;
        this.maskedImageData = null;
        this.resizedImageData = null;

        this.hasLineMask = false;
        this.lineMaskID = -1;
        this.lineMaskSwitch = true;

        this.hasRecMask = false;
        this.recMaskID = -1;
        this.recMaskYPos = -1;
        this.recMaskFrame = -1;
        this.recMaskWidth = 3;
        this.recMaskHeight = 3;
        this.recMaskThreshold = 1;
        this.recMaskColorIdx = -1;
        this.recMaskSwitch = true;

        this.colors = [
            "#313695",
            "#4575B4",
            "#74ADD1",
            "#ABD9E9",
            "#E0F3F8",
            "#FEE090",
            "#FDAE61",
            "#F46D43",
            "#D73027",
            "#A50026"
        ];
        this.contrastingColors = [
            "#CEC96A",
            "#BA8A4B",
            "#8B522E",
            "#542616",
            "#1F0C07",
            "#011F6F",
            "#02519E",
            "#0B92BC",
            "#28CFD8",
            "#5AFFD9"
        ];
    }

    updateData() {
        this.generateRawImageData(this.feature);
        this.generateMaskedImageData();

        this.resizedImageData = resizeImageData(this.maskedImageData, this.maskedImageData.width * motionRugs.resizeScale, this.maskedImageData.height * motionRugs.resizeScale);
        this.ctx.putImageData(this.resizedImageData, 0, 0);
    }

    generateRawImageData(feature = "Velocity") {
        const tempImageData = new ImageData(motionRugsDataset.orderedData.length, motionRugsDataset.orderedData[0].length);
        for (let x = 0; x < motionRugsDataset.orderedData.length; x++) {
            for (let y = 0; y < motionRugsDataset.orderedData[x].length; y++) {
                const colorIdx = this.getColorIdx(motionRugsDataset.orderedData[x][y][feature])
                const color = this.colors[colorIdx];
                const idx = (y * motionRugsDataset.orderedData.length + x) * 4;
                tempImageData.data[idx] = parseInt(color.substring(1, 3), 16);
                tempImageData.data[idx + 1] = parseInt(color.substring(3, 5), 16);
                tempImageData.data[idx + 2] = parseInt(color.substring(5, 7), 16);
                tempImageData.data[idx + 3] = 255;

                motionRugsDataset.orderedData[x][y].colorIdx = colorIdx;
            }
        }

        this.rawImageData = tempImageData;
    }

    getColorIdx = (featureValue) => {
        if (featureValue < motionRugsDataset.deciles[0]) {
            return 0;
        } else if (featureValue >= motionRugsDataset.deciles[8]) {
            return 9;
        } else {
            for (let i = 0; i <= 7; i++) {
                if (featureValue >= motionRugsDataset.deciles[i] && featureValue < motionRugsDataset.deciles[i + 1]) {
                    return i + 1;
                }
            }
        }
    }

    generateMaskedImageData() {
        this.maskedImageData = this.rawImageData;

        // this.clearAllMask();
        if (this.addLineMask()) {
            return;
        }
        if (this.addRecMask()) {
            return;
        }
    }


    setHasLineMask(flag, frame = 0, pos = -1) {
        this.hasLineMask = flag;
        this.hasRecMask = false;
        if (pos !== -1) {
            this.lineMaskID = motionRugsDataset.orderedToID[frame][pos];
            this.lineMaskSwitch = true;
        } else {
            this.lineMaskID = -1;
        }

        for (let i = 0; i < Object.keys(movers).length; i++) {
            movers[Object.keys(movers)[i]].setHasPolyLines(false);
        }
        if (this.hasLineMask) {
            movers[this.lineMaskID].setHasPolyLines(flag);
        }
        this.updateData();
    }

    addLineMask() {
        if (!this.hasLineMask) {
            return false;
        }
        if (!this.lineMaskSwitch) {
            this.lineMaskSwitch = true;
            return true;
        } else {
            this.lineMaskSwitch = false;
        }

        for (let i = 0; i < motionRugsDataset.orderedData.length; i++) {
            for (let j = 0; j < motionRugsDataset.orderedData[i].length; j++) {
                if (motionRugsDataset.orderedData[i][j].TrackID === this.lineMaskID) {
                    const idx = (j * motionRugsDataset.orderedData.length + i) * 4;
                    const idxTop = ((j - 1) * motionRugsDataset.orderedData.length + i) * 4;
                    const idxBottom = ((j + 1) * motionRugsDataset.orderedData.length + i) * 4;

                    const colorIdx = this.getColorIdx(motionRugsDataset.orderedData[i][j][this.feature])

                    this.maskedImageData.data[idx] = 255;
                    this.maskedImageData.data[idx + 1] = 255;
                    this.maskedImageData.data[idx + 2] = 255;
                    this.maskedImageData.data[idx + 3] = 255;


                    // this.maskedImageData.data[idx] = parseInt(this.contrastingColors[colorIdx].substring(1, 3), 16);
                    // this.maskedImageData.data[idx + 1] = parseInt(this.contrastingColors[colorIdx].substring(3, 5), 16);
                    // this.maskedImageData.data[idx + 2] = parseInt(this.contrastingColors[colorIdx].substring(5, 7), 16);
                    // this.maskedImageData.data[idx + 3] = 255;
                    //
                    // if (j > 0) {
                    //     this.maskedImageData.data[idxTop] = parseInt(this.contrastingColors[colorIdx].substring(1, 3), 16);
                    //     this.maskedImageData.data[idxTop + 1] = parseInt(this.contrastingColors[colorIdx].substring(3, 5), 16);
                    //     this.maskedImageData.data[idxTop + 2] = parseInt(this.contrastingColors[colorIdx].substring(5, 7), 16);
                    //     this.maskedImageData.data[idxTop + 3] = 255;
                    // }
                    //
                    // if (j < motionRugsDataset.orderedData[i].length - 1) {
                    //     this.maskedImageData.data[idxBottom] = parseInt(this.contrastingColors[colorIdx].substring(1, 3), 16);
                    //     this.maskedImageData.data[idxBottom + 1] = parseInt(this.contrastingColors[colorIdx].substring(3, 5), 16);
                    //     this.maskedImageData.data[idxBottom + 2] = parseInt(this.contrastingColors[colorIdx].substring(5, 7), 16);
                    //     this.maskedImageData.data[idxBottom + 3] = 255;
                    // }
                    break;
                }
            }
        }
        return true;
    }

    setHasRecMask(flag, frame = 0, pos = -1) {
        this.hasRecMask = flag;
        this.hasLineMask = false;
        if (pos !== -1) {
            this.recMaskID = motionRugsDataset.orderedToID[frame][pos];
            this.recMaskFrame = frame;
            this.recMaskYPos = pos;
            this.recMaskColorIdx = motionRugsDataset.orderedData[frame][pos].colorIdx;
            this.recMaskSwitch = true;
        } else {
            this.recMaskID = -1;
            this.recMaskFrame = -1;
            for (let i = 0; i < Object.keys(movers).length; i++) {
                movers[Object.keys(movers)[i]].clearStatic();
            }
        }
        this.updateData();
    }

    // TODO: 这里的颜色有问题
    addRecMask() {
        if (!this.hasRecMask) {
            return false;
        }

        if (!this.recMaskSwitch) {
            this.recMaskSwitch = true;
            return true;
        } else {
            this.recMaskSwitch = false;
        }

        for (let i = 0; i < Object.keys(movers).length; i++) {
            movers[Object.keys(movers)[i]].clearStatic();
        }

        const centerX = this.recMaskFrame;
        const centerY = this.recMaskYPos;
        const leftBound = Math.max(0, centerX - this.recMaskWidth);
        const rightBound = Math.min(motionRugsDataset.orderedData.length - 1, centerX + this.recMaskWidth);
        const topBound = Math.max(0, centerY - this.recMaskHeight);
        const bottomBound = Math.min(motionRugsDataset.orderedData[centerX].length - 1, centerY + this.recMaskHeight);
        for (let x = leftBound; x <= rightBound; x++) {
            for (let y = topBound; y <= bottomBound; y++) {
                if (Math.abs(motionRugsDataset.orderedData[centerX][centerY].colorIdx - motionRugsDataset.orderedData[x][y].colorIdx) <= this.recMaskThreshold) {
                    const idx = (y * motionRugsDataset.orderedData.length + x) * 4;
                    // this.maskedImageData.data[idx] = parseInt(this.contrastingColors[this.recMaskColorIdx].substring(1, 3), 16);
                    // this.maskedImageData.data[idx + 1] = parseInt(this.contrastingColors[this.recMaskColorIdx].substring(3, 5), 16);
                    // this.maskedImageData.data[idx + 2] = parseInt(this.contrastingColors[this.recMaskColorIdx].substring(5, 7), 16);
                    this.maskedImageData.data[idx] = parseInt(this.colors[this.recMaskColorIdx].substring(1, 3), 16);
                    this.maskedImageData.data[idx + 1] = parseInt(this.colors[this.recMaskColorIdx].substring(3, 5), 16);
                    this.maskedImageData.data[idx + 2] = parseInt(this.colors[this.recMaskColorIdx].substring(5, 7), 16);
                    this.maskedImageData.data[idx + 3] = 255;

                    try {
                        movers[motionRugsDataset.orderedToID[x][y]].addStaticPolyLine(x);
                    } catch (e) {
                        console.log(e, x, y, motionRugsDataset.orderedToID[x][y]);
                    }
                }
            }
        }

        return true;
    }

    clearAllMask() {
        this.setHasLineMask(false);
        this.setHasRecMask(false);
    }
}


motionRugs = new MotionRugs();
hotkeys("ctrl+1", () => {
    motionRugs.clearAllMask();
})

// ========================= Processor =========================
class MotionRugsDataset {
    constructor() {
        this.baseData = [];
        this.maxDataLength = 2000;
        this.orderedData = [];
        this.deciles = [];
        this.orderedToID = [];

        this.strategyName = globalStrategy;
        this.featureName = globalFeature;

        this.idxxx = [];
        this.tauList = [];
    }

    setMaxDataLength(maxDataLength) {
        this.maxDataLength = Math.floor(maxDataLength / motionRugs.resizeScale);
        ElMessage({
            message: "Max data length is set to " + this.maxDataLength,
            type: "success",
            duration: 1000
        });
    }

    newData(data) {
        this.baseData.push(data);
        if (this.baseData.length > this.maxDataLength) {
            this.baseData.shift();
            this.orderedData.shift();
            this.orderedToID.shift();
        }
        this.getOrderedData(this.strategyName);
        this.getDeciles(this.featureName);


        if (this.orderedData.length > 1) {
            this.calcKendallTau();
        }
        motionRugs.updateData();
    }

    calcKendallTau = () => {
        // 分别是一个obj list
        const A = this.orderedData[this.orderedData.length - 1];
        const B = this.orderedData[this.orderedData.length - 2];

        let concordant = 0, discordant = 0, tied = 0;
        for (let i = 0; i < A.length; i++) {
            for (let j = i + 1; j < B.length; j++) {
                if ((A[j].TrackID - A[i].TrackID) * (B[j].TrackID - B[i].TrackID) > 0) {
                    concordant++;
                } else if ((A[i].TrackID - A[j].TrackID) * (B[i].TrackID - B[j].TrackID) < 0) {
                    discordant++;
                } else {
                    tied++;
                }
            }
        }

        let ans = (concordant - discordant) / (concordant + discordant + tied);
        // console.log("concordant", concordant, "discordant", discordant, "tied", tied, "ans", ans);
        this.tauList.push(ans);
        if (this.tauList.length % 25 === 0) {
            const sum = this.tauList.reduce((a, b) => a + b, 0);
            const mean = sum / this.tauList.length;
            const maxx = Math.max(...this.tauList);
            const minn = Math.min(...this.tauList);
            const mid = Math.floor(this.tauList.length / 2);
            const variance = this.tauList.reduce((a, b) => a + (b - mean) ** 2, 0) / this.tauList.length;
            console.log("avg:", sum / this.tauList.length, "max:", maxx, "min:", minn, "mid:", this.tauList[mid], "variance:", variance);
        }
    };

    // 对这一frame的数据（这帧上的切片）进行排序
    getOrderedData(strategyName = "zOrder", frame = this.baseData.length - 1) {
        if (frame < 0 || frame >= this.baseData.length) {
            return;
        }
        if (this.orderedData[frame]) {
            return this.orderedData[frame];
        }

        if (strategyName === "zOrder") {
            // console.time("zOrder");
            this.zOrder(frame);
            // console.timeEnd("zOrder");
        } else if (strategyName === "hilbertOrder") {
            // console.time("hilbertOrder");
            this.hilbertOrder(frame);
            // console.timeEnd("hilbertOrder");
        } else if (strategyName === "geoHashOrder") {
            // console.time("geoHashOrder");
            this.geoHashOrder(frame);
            // console.timeEnd("geoHashOrder");
        }

    }

    zOrder(frame) {
        const zOrderIndex = (lat, lon, id = -1) => {
            const BITS = 32; // 索引值的位数

            // 将经度值和纬度值映射到[0, 2^BITS-1]的整数范围内
            const latInt = Math.round((lat - 30) * (1 << (BITS - 10)));
            const lonInt = Math.round((lon + 180) * (1 << (BITS - 9)));

            let index = 0;
            for (let i = 0; i < BITS / 2; i++) {
                // 每次取一位经纬度坐标的二进制位，并将其交替组合成一个32位整数
                const bitMask = 1 << (BITS - i * 2 - 1);
                const latBit = latInt & bitMask ? 1 : 0;
                const lonBit = lonInt & bitMask ? 1 : 0;
                const interleavedBits = (latBit << 1) | lonBit;
                index |= interleavedBits << (BITS - i * 2 - 2);
            }
            // if (frame === 0) {
            //     this.idxxx.push([id, index]);
            //     this.idxxx.sort((a, b) => (a[1] - b[1]))
            //     // 去重
            //     for (let i = 0; i < this.idxxx.length - 1; i++) {
            //         if (this.idxxx[i][1] === this.idxxx[i + 1][1]) {
            //             this.idxxx.splice(i, 1);
            //             i--;
            //         }
            //     }
            //     console.log(this.idxxx.sort((a, b) => (a[1] - b[1])));
            // }
            return index;
        }
        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return zOrderIndex(a.LatitudeGPS, a.LongitudeGPS, a.TrackID) - zOrderIndex(b.LatitudeGPS, b.LongitudeGPS, b.TrackID);
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    hilbertOrder(frame) {
        const hilbert2 = (x, y, n = 65536) => {
            function rotate(n, x, y, rx, ry) {
                if (ry === 0) {
                    if (rx & n) {
                        x = n - 1 - x;
                        y = n - 1 - y;
                    }
                    let t = x;
                    x = y;
                    y = t;
                }
            }

            x = parseInt((x * 100000).toString().substring(3))
            y = parseInt((y * 100000).toString().substring(3))
            let rx = 0;
            let ry = 0;
            let s = Math.floor(n / 2);
            let d = 0;
            while (s > 0) {
                if (x & s) {
                    rx ^= s - 1;
                }
                if (y & s) {
                    ry ^= s - 1;
                }
                d += s * s * ((3 * rx) ^ ry);
                rotate(s, x, y, rx, ry);
                s = Math.floor(s / 2);
            }
            return d;
        }
        const hilbertCurveIndex = (lat, lon, id = -1) => {
            lat = lat * 2000;
            lon = lon * 2000;

            const n = 65536; // 网格数量
            const latRange = [30 * 2000, 40 * 2000]; // 纬度范围
            const lonRange = [-90 * 2000, -80 * 2000]; // 经度范围

            // 将经纬度转换为网格索引
            const latIndex = Math.floor(((lat - latRange[1]) / (latRange[0] - latRange[1])) * n);
            const lonIndex = Math.floor(((lon - lonRange[0]) / (lonRange[1] - lonRange[0])) * n);
            console.log(latIndex, lonIndex)
            // 将网格索引转换为希尔伯特曲线索引
            let index = 0;
            let mask = 1 << 15;
            for (let i = 0; i < 16; i++) {
                const hX = (latIndex & mask) > 0 ? 1 : 0;
                const hY = (lonIndex & mask) > 0 ? 1 : 0;
                index += mask * ((3 * hX) ^ hY);
                mask >>= 1;
            }
            mask = 1 << 31;
            for (let i = 16; i < 32; i++) {
                const hX = (latIndex & mask) > 0 ? 1 : 0;
                const hY = (lonIndex & mask) > 0 ? 1 : 0;
                index += mask * ((3 * hX) ^ hY);
                mask >>= 1;
            }
// if (frame === 0) {
//                 this.idxxx.push([id, index]);
//                 this.idxxx.sort((a, b) => (a[1] - b[1]))
//                 // 去重
//                 for (let i = 0; i < this.idxxx.length - 1; i++) {
//                     if (this.idxxx[i][1] === this.idxxx[i + 1][1]) {
//                         this.idxxx.splice(i, 1);
//                         i--;
//                     }
//                 }
//                 console.log(this.idxxx.sort((a, b) => (a[1] - b[1])));
//             }
            return index;
        }

        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            // return hilbertCurveIndex(a.LatitudeGPS, a.LongitudeGPS, a.TrackID) - hilbertCurveIndex(b.LatitudeGPS, b.LongitudeGPS, b.TrackID);
            return hilbert2(a.LatitudeGPS, a.LongitudeGPS) - hilbert2(b.LatitudeGPS, b.LongitudeGPS);
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    geoHashOrder(frame) {
        // 将经纬度转换为索引值
        const latLngToIndex = (lat, lng, id = -1) => {
            const LAT_RATIO = 1000000;
            const LNG_RATIO = 1000000;

            // 将经度和纬度转换为整数
            const latInt = Math.round(lat * LAT_RATIO);
            const lngInt = Math.round(lng * LNG_RATIO);

            // console.log(lngInt, (lngInt >>> 0), (lngInt >>> 0).toString(2))
            // console.log((latInt >> 0).toString(2), (lngInt >> 0).toString(2));
            // 将经度和纬度的整数值转换为二进制并拼接起来
            const binStr = (latInt >>> 0).toString(2).padStart(32, "0") + (lngInt >>> 0).toString(2).padStart(32, "0");

            // 将二进制字符串从左到右每两位分割成一组，将每组转换为一个十进制数字
            const index = [];
            for (let i = 0; i < binStr.length; i += 2) {
                const group = binStr.slice(i, i + 2);
                // console.log(group, parseInt(group, 2));
                index.push(parseInt(group, 2));
            }
            // 00000010 00100111 00000100 01101101 11111010 11010100 10110110 10010101
            // if (frame === 0) {
            //     this.idxxx.push(index);
            //
            //     let hasDel = true;
            //     while (hasDel) {
            //         hasDel = false;
            //         for (let i = 0; i < this.idxxx.length - 1; i++) {
            //             if (this.idxxx[i].join("") === this.idxxx[i + 1].join("")) {
            //                 this.idxxx.splice(i, 1);
            //                 i--;
            //                 hasDel = true;
            //             }
            //         }
            //     }
            //
            //     console.log(this.idxxx.sort((a, b) => (a[1] - b[1])));
            // }
            return index;
        }

        // 比较两个经纬度索引值的大小
        const compareLatLngIndex = (index1, index2) => {
            for (let i = 0; i < 32; i++) {
                // 32 是经纬度索引值的长度
                if (index1[i] === index2[i]) {
                    continue;
                } else {
                    return index1[i] > index2[i] ? 1 : -1;
                }
            }
            return 0;
        }

        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return compareLatLngIndex(latLngToIndex(a.LatitudeGPS, a.LongitudeGPS, a.TrackID), latLngToIndex(b.LatitudeGPS, b.LongitudeGPS, b.TrackID));
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    getDeciles(feature = "Velocity") {
        const flattedData = this.baseData.flat();
        flattedData.sort((a, b) => {
            return a[feature] - b[feature];
        });
        for (let i = 1; i < 10; i++) {
            this.deciles[i - 1] = flattedData[Math.floor(i / 10 * flattedData.length)][feature];
        }
    }

}

motionRugsDataset = new MotionRugsDataset();

// ========================= events =========================
class EventProcessor {
    constructor() {
        this.eventColor = [
            "#a0cfff",
            "#f3d19e",
            "#f89898",
        ]
        this.eventTag = [
            "primary",
            "warning",
            "danger",
        ]
        this.msgTag = [
            "info",
            "warning",
            "error",
        ]
        this.btnTag = [
            "primary",
            "warning",
            "danger",
        ]
        this.eventMarkers = {};
        this.gIdx = 0;
    }

    newEvent(rank, img, msg, pos, loc) {
        const tempEvent = {
            idx: this.gIdx,
            rk: Math.floor(rank),
            clr: this.eventColor[Math.floor(rank)],
            img: img,
            msg: msg,
            pos: pos,
            loc: loc,
            tag: this.eventTag[Math.floor(rank)],
        }
        events.push(tempEvent)
        events.sort((a, b) => {
            return b.rk - a.rk;
        });

        this.eventMarkers[this.gIdx] = L.marker(loc, {
            icon: L.icon({
                iconUrl: (rank >= 2 ? '/dangerous.svg' : (rank >= 1 ? '/warning.svg' : '/info.svg')),
                iconSize: [28, 28],
            })
        }).addTo(map).bindPopup(
            `<div class="event-popup">
                <div class="event-popup-img">
                    <img src="${img}" alt="event-img" width="64px">
                </div>
                <div class="event-popup-msg">
                    <p>${msg}</p>
                </div>
                `
        ).openPopup();
        this.gIdx++;

        map.panTo(loc);

        if (tempEvent.rk > 1) {
            ElMessage({
                message: msg,
                type: this.msgTag[Math.floor(rank)],
                duration: 0,
                showClose: true,
            });
            mapController.sidebar.open("allEvents");
        }
    }

    finishEvent(idx) {
        this.eventMarkers[idx].remove();
        delete this.eventMarkers[idx];
        for (let i = 0; i < events.length; i++) {
            if (events[i].idx === idx) {
                events.splice(i, 1);
                break;
            }
        }
    }

    findEvent(idx) {
        for (let i = 0; i < events.length; i++) {
            if (events[i].idx === idx) {
                map.panTo(events[i].loc);
                break;
            }
        }
        this.eventMarkers[idx].openPopup();
    }

    moversGo(idx) {
        let loc;
        for (let i = 0; i < events.length; i++) {
            if (events[i].idx === idx) {
                loc = events[i].loc;
                break;
            }
        }

        for (let i = 0; i < Object.keys(movers).length; i++) {
            const mover = movers[Object.keys(movers)[i]];
            mover.newData(loc, 0, 50, 1);
        }
    }
}

eventProcessor = new EventProcessor();

// ========================= 路径设置 =========================
class PathController {
    constructor() {
        this.idx = 1;
        this.isRec = false;
        this.tempPath = [];
        this.tempMarkers = [];
        this.tempPolyLines = [];
        this.pathForm = {
            name: "",
            activeDevice: ['无人机'],
            loopGo: false,
        }
        this.showedPolyline = null;
    }

    newPath() {
        this.isRec = true;
        map.on("click", (e) => {
            this.tempPath.push(e.latlng);

            this.tempMarkers.push(L.marker(this.tempPath[this.tempPath.length - 1], {
                icon: L.icon({
                    iconUrl: '/vite.svg',
                    iconSize: [28, 28],
                })
            }).addTo(map));
            if (this.tempPath.length >= 2) {
                this.tempPolyLines.push(L.polyline([this.tempPath[this.tempPath.length - 2], this.tempPath[this.tempPath.length - 1]], {
                    color: "#ff0000",
                    weight: 3,
                }).arrowheads().addTo(map))

            }
        });
    }

    checkRecording() {
        return this.isRec;
    }

    finishRecord() {
        if (this.pathForm.loopGo && this.tempPath.length >= 2) {
            this.tempPath.push(this.tempPath[0])
        }
        paths.push({
            name: this.pathForm.name === "" ? "路径" + this.idx++ : this.pathForm.name,
            activeDevice: this.pathForm.activeDevice,
            length: this.tempPath.length,
            path: this.tempPath,
            loopGo: this.pathForm.loopGo,
        })
        this.clearRecord()
    }

    delLast() {
        if (this.tempPath.length > 0) {
            this.tempPath.pop();
            this.tempMarkers.pop().remove();
            if (this.tempPath.length > 1) {
                this.tempPolyLines.pop().remove();
            }
        }
    }

    clearRecord() {
        this.isRec = false;
        map.off("click");
        for (let i = 0; i < this.tempMarkers.length; i++) {
            this.tempMarkers[i].remove();
        }
        for (let i = 0; i < this.tempPolyLines.length; i++) {
            this.tempPolyLines[i].remove();
        }
        this.tempPath = [];
        this.tempMarkers = [];
        this.tempPolyLines = [];
    }

    delPath(idx) {
        paths.splice(idx, 1);
    }

    showPath(idx) {
        const path = paths[idx].path;
        if (this.showedPolyLine) {
            this.showedPolyLine.remove();
            this.showedPolyLine = null;
        }
        this.showedPolyLine = L.polyline(path, {
            color: "#ff7700",
            weight: 3,
        }).arrowheads().addTo(map);
        setTimeout(() => {
            if (this.showedPolyLine) {
                this.showedPolyLine.remove();
                this.showedPolyLine = null;
            }
        }, 3000)
    }
}

let pathController = reactive(new PathController());
// ========================= 数据监听 =========================
onMounted(() => {
    myMap.createMap();
    mapController = new MapController();

    motionRugs.canvas = document.getElementById("canvas");
    motionRugs.ctx = motionRugs.canvas.getContext("2d");
    motionRugs.canvas.width = pixelContainerRef.value.clientWidth;
    motionRugs.canvas.height = 14 * motionRugs.resizeScale;

    motionRugsDataset.setMaxDataLength(pixelContainerRef.value.clientWidth)
    DataAdaptor.Listener((data) => {
        const {type} = data;
        if (type === "Trajectory") {
            const {fData, fNum} = data;

            if (fData[0].Time !== -11) {
                motionRugsDataset.newData(fData);
            }

            fData.forEach((item) => {
                const {Time, TrackID, LatitudeGPS, LongitudeGPS, Velocity, Acceleration, Type} = item;
                const loc = [LatitudeGPS, LongitudeGPS];
                if (!(TrackID in movers)) {
                    movers[TrackID] = new Mover(TrackID, Type);
                    movers[TrackID].setFrameLength(pixelContainerRef.value.clientWidth);
                }
                if (Time !== -11) {
                    movers[TrackID].newData(loc, fNum, Velocity, Acceleration)
                }
            });
        } else if (type === "Event") {
            const {rank, img, msg, pos, loc} = data;
            eventProcessor.newEvent(rank, img, msg, pos, loc);
        }
    });
});

const findMover = (id) => {
    console.log("findMover", id);

    myMap.nowCenter = movers[id].locList[movers[id].locList.length - 1];
    map.panTo(movers[id].locList[movers[id].locList.length - 1]);

};
const clkMotionRugs = (e) => {
    const x = e.offsetX - 1;
    const y = e.offsetY - 1;
    const frameNum = Math.floor(x / motionRugs.resizeScale);
    const trackID = Math.floor(y / motionRugs.resizeScale);

    if (frameNum < 0 || frameNum >= motionRugsDataset.baseData.length) {
        motionRugs.clearAllMask();
    } else {
        motionRugs.setHasRecMask(false);
        motionRugs.setHasLineMask(true, frameNum, trackID);
        console.log(`clkMotionRugs: frameNum: ${frameNum}, trackID: ${trackID}, x: ${x}, y: ${y}`);
    }
}

const rclkMotionRugs = (e) => {
    e.preventDefault();
    const x = e.offsetX - 1;
    const y = e.offsetY - 1;
    const frameNum = Math.floor(x / motionRugs.resizeScale);
    const trackID = Math.floor(y / motionRugs.resizeScale);

    if (frameNum < 0 || frameNum >= motionRugsDataset.baseData.length) {
        motionRugs.clearAllMask();
    } else {
        motionRugs.setHasLineMask(false);
        motionRugs.setHasRecMask(true, frameNum, trackID);
        console.log(`rclkMotionRugs: frameNum: ${frameNum}, trackID: ${trackID}, x: ${x}, y: ${y}`);

    }
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
                    <li>
                        <a href="#allControls" role="tab" class="tab-icon">
                            <img src="/path.svg" width="23" height="40" alt=""/>
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
                                    <span class="mover-card-title"
                                          :style="{ color:`${movers[key].hasPolyLines  ? 'green' : (movers[key].staticPolyLines.length !== 0 ? 'blue' : 'black')}` }"> 设备编号：{{
                                        parseInt(key)
                                        }} </span>
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
                    <div v-for="item in events">
                        <el-card class="event-card">
                            <img :src="item.img" :style="{objectFit: 'fill', height: '200px', width: '100%'}" alt=""/>
                            <el-descriptions direction="horizontal" :column="1" :border="true">
                                <el-descriptions-item label="类型">
                                    <el-tag :type="item.tag" effect="dark">{{ item.msg }}</el-tag>
                                </el-descriptions-item>
                                <el-descriptions-item label="位置">{{ item.pos }}</el-descriptions-item>
                            </el-descriptions>
                            <el-button-group>
                                <el-button :style="{width: '36.4%'}" @click="eventProcessor.findEvent(item.idx)">
                                    定位
                                </el-button>
                                <el-button :style="{width: '31.8%'}" @click="eventProcessor.moversGo(item.idx)">
                                    派遣
                                </el-button>
                                <el-button :type="item.tag" :style="{width: '31.8%'}"
                                           @click="eventProcessor.finishEvent(item.idx)" plain>
                                    完成
                                </el-button>
                                <!--                                <el-popconfirm title="是否派遣设备？" confirm-button-text="确定"-->
                                <!--                                               cancel-button-text="取消"-->
                                <!--                                               @confirm="eventProcessor.moversGo(item.idx)">-->
                                <!--                                    <template #reference>-->
                                <!--                                        <el-button :style="{width: '100%'}">-->
                                <!--                                            快速派遣-->
                                <!--                                        </el-button>-->
                                <!--                                    </template>-->
                                <!--                                </el-popconfirm>-->

                                <!--                                <el-popconfirm title="完成这个事件？" confirm-button-text="确定"-->
                                <!--                                               cancel-button-text="取消"-->
                                <!--                                               @confirm="eventProcessor.finishEvent(item.idx)">-->
                                <!--                                    <template #reference>-->
                                <!--                                        <el-button :type="item.tag" :style="{width: '100%'}">-->
                                <!--                                            完成事件-->
                                <!--                                        </el-button>-->
                                <!--                                    </template>-->
                                <!--                                </el-popconfirm>-->

                            </el-button-group>
                        </el-card>
                    </div>
                </div>

                <div class="leaflet-sidebar-pane" id="allControls">
                    <h1 class="leaflet-sidebar-header">路径设置</h1>
                    <el-button :disabled="pathController.checkRecording() === true"
                               :style="{width: '100%', marginTop: '10px'}" type="primary"
                               @click="pathController.newPath()" plain>添加路径
                    </el-button>
                    <!--                    <el-button-group v-else>-->
                    <!--                        <el-button :style="{width: '50%'}" type="success" @click="pathController.finishRecord()" plain>完成设置</el-button>-->
                    <!--                        <el-button :style="{width: '50%'}" type="danger" @click="pathController.delLast()" plain>删除上一个</el-button>-->
                    <!--                    </el-button-group>-->
                    <el-card :style="{padding: '10px', marginTop: '10px', marginBottom: '10px'}"
                             v-if="pathController.checkRecording() === true">
                        <el-form :label-position="'left'">
                            <el-form-item label="路线名称">
                                <el-input placeholder="默认名称" v-model="pathController.pathForm.name"/>
                            </el-form-item>
                            <el-form-item label="执行设备">
                                <el-checkbox-group v-model="pathController.pathForm.activeDevice">
                                    <el-checkbox label="无人机" name="type"/>
                                    <el-checkbox label="无人车" name="type"/>
                                    <el-checkbox label="无人船" name="type"/>
                                </el-checkbox-group>
                            </el-form-item>
                            <el-form-item label="已标记巡逻点">
                                {{ Math.max(0, pathController.tempPath.length) }}&nbsp;&nbsp;
                                <el-button type="danger" @click="pathController.delLast()" plain>删除上一个点
                                </el-button>
                            </el-form-item>
                            <el-form-item label="循环执行">
                                <el-switch v-model="pathController.pathForm.loopGo"/>
                            </el-form-item>
                            <el-form-item>
                                <el-button type="primary" @click="pathController.finishRecord()">完成设置</el-button>
                                <el-button @click="pathController.clearRecord()">取消设置</el-button>
                            </el-form-item>
                        </el-form>
                    </el-card>
                    <div v-for="(item, index) in paths">
                        <el-card :style="{padding: '10px', marginTop: '10px'}">
                            <el-descriptions :column="1" :border="true">
                                <el-descriptions-item label="名称">
                                    {{ item.name }}
                                </el-descriptions-item>
                                <el-descriptions-item label="设备">
                                    <span v-for="device in item.activeDevice">
                                        <el-tag :type="device === '无人机' ? '' : (device === '无人船' ? 'success' : 'warning')"
                                                effect="dark">{{ device }}</el-tag>&nbsp;
                                    </span>
                                </el-descriptions-item>
                                <el-descriptions-item label="巡逻点数量">
                                    {{ item.path.length }}
                                </el-descriptions-item>
                                <el-descriptions-item label="循环执行">
                                    <el-tag :type="item.loopGo === true ? 'success' : 'danger'"
                                            effect="dark">{{ item.loopGo === true ? '是' : '否' }}
                                    </el-tag>
                                </el-descriptions-item>
                            </el-descriptions>
                            <div :style="{width: '100%'}">
                                <el-button-group>
                                    <el-button :style="{width: '33%'}"
                                               :disabled="pathController.checkRecording() === true" type="default"
                                               @click="pathController.showPath(index)" plain>显示
                                    </el-button>
                                    <el-button :style="{width: '33%'}"
                                               :disabled="pathController.checkRecording() === true" type="primary"
                                               plain>执行
                                    </el-button>
                                    <el-button :style="{width: '33%'}"
                                               :disabled="pathController.checkRecording() === true" type="danger"
                                               @click="pathController.delPath(index)" plain>删除
                                    </el-button>
                                </el-button-group>
                            </div>
                        </el-card>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="motionrugs-container" ref="pixelContainerRef" v-loading="motionRugsDataset.baseData.length === 0">
        <canvas id="canvas" @click="clkMotionRugs" @click.right="rclkMotionRugs"
                @click.middle="motionRugs.clearAllMask"></canvas>
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

.event-card {
    margin-bottom: 10px;
    margin-top: 10px;
}

.el-button-group {
    /*margin-top: 10px;*/
    width: 100%;
}
</style>
