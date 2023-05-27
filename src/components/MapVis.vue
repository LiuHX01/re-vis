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

import {grid} from "../tools/touying.js"
import {Config} from "../tools/config.js";

import {S2} from "s2-geometry/src/s2geometry.js";
import geo from "geo-hash/index.js";
import {saveAs} from "file-saver"

let map = null;
let myMap = null;
let mapController = null;
let movers = reactive({}); // key为TrackID，value为Mover对象
let motionRugs = null;
let motionRugsDataset = null;
let pixelContainerRef = ref(null);
let eventProcessor = null;
let events = reactive([])
let paths = reactive([{
    name: "默认路径",
    activeDevice: ["无人机"],
    length: 2,
    path: [[36.1115717, -86.7230948], [36.1112088, -86.7227895]],
    loopGo: false,
}])

const globalStrategy = Config.Strategy;
const globalFeature = Config.Feature;
const hasDownload = !Config.downloadOpen;
const globalColor = Config.defaultColors;

// ========================= 地图自身 =========================
class MyMap {
    constructor() {
        this.zoom = 16;
        this.maxZoom = 40;
        this.minZoom = 5;
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
        this.moveDuration = Config.Duration;

        this.hasPolyLines = false;
        this.maxPolyLineLength = 200;
        this.polyLines = [];

        this.hasStaticPolyLines = false;
        this.staticPolyLines = [];
        this.staticMarkers = [];

        this.colors = globalColor;

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
        this.recMaskWidth = 5;
        this.recMaskHeight = 3;
        this.recMaskThreshold = 1;
        this.recMaskColorIdx = -1;
        this.recMaskSwitch = true;

        this.colors = globalColor;
        this.hasDownloaded = hasDownload;
    }

    saveImg() {
        if (!this.hasDownloaded && motionRugsDataset.orderedData.length === 420) {
            console.log("download")
            this.canvas.toBlob(function (blob) {
                saveAs(blob, `I24_${globalStrategy}_${motionRugsDataset.orderedData.length}.png`);
            });
            this.hasDownloaded = true;
        }
    }

    downloadImg() {
        this.canvas.toBlob(function (blob) {
            saveAs(blob, `A_${globalStrategy}_${motionRugsDataset.orderedData.length}.png`);
        });
    }

    updateData() {
        this.generateRawImageData(this.feature);
        this.generateMaskedImageData();

        this.resizedImageData = resizeImageData(this.maskedImageData, this.maskedImageData.width * motionRugs.resizeScale, this.maskedImageData.height * motionRugs.resizeScale);
        this.ctx.putImageData(this.resizedImageData, 0, 0);
        this.saveImg();
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
                    // this.maskedImageData.data[idx] = parseInt(this.colors[this.recMaskColorIdx].substring(1, 3), 16);
                    // this.maskedImageData.data[idx + 1] = parseInt(this.colors[this.recMaskColorIdx].substring(3, 5), 16);
                    // this.maskedImageData.data[idx + 2] = parseInt(this.colors[this.recMaskColorIdx].substring(5, 7), 16);
                    // this.maskedImageData.data[idx + 3] = 255;
                    this.maskedImageData.data[idx] = 255;
                    this.maskedImageData.data[idx + 1] = 255;
                    this.maskedImageData.data[idx + 2] = 255;
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

hotkeys("ctrl+0", () => {
    motionRugs.downloadImg();
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

        this.tauList = [];
        this.skips = [];
        this.crossings = [];
    }

    setMaxDataLength(maxDataLength) {
        this.maxDataLength = Math.floor(maxDataLength / motionRugs.resizeScale);
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


        if (Config.calcOpen && this.orderedData.length > 1) {
            this.calcKendallTau();
            this.calcSkips();
        }
        motionRugs.updateData();
    }

    calcKendallTau() {
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
        this.crossings.push(discordant);
        let ans = (concordant - discordant) / (concordant + discordant + tied);

        this.tauList.push(ans);
        if (this.tauList.length % 50 === 0) {
            const sum = this.tauList.reduce((a, b) => a + b, 0);
            const mean = sum / this.tauList.length;
            const maxx = Math.max(...this.tauList);
            const minn = Math.min(...this.tauList);
            const mid = Math.floor(this.tauList.length / 2);
            const median = this.tauList.sort((a, b) => a - b)[mid];

            const variance = Math.sqrt(this.tauList.reduce((a, b) => a + (b - mean) ** 2, 0) / this.tauList.length);
            // console.log("[Kendall Tau] len:", this.tauList.length, "avg:", (sum / this.tauList.length).toFixed(4), "max:", maxx.toFixed(4), "min:", minn.toFixed(4), "mid:", this.tauList[mid].toFixed(4), "variance:", variance.toFixed(4));


            const sum2 = this.crossings.reduce((a, b) => a + b, 0);
            const mean2 = sum2 / this.crossings.length;
            const maxx2 = Math.max(...this.crossings);
            const minn2 = Math.min(...this.crossings);
            const mid2 = Math.floor(this.crossings.length / 2);
            const median2 = this.crossings.sort((a, b) => a - b)[mid2];
            const variance2 = Math.sqrt(this.crossings.reduce((a, b) => a + (b - mean2) ** 2, 0) / this.crossings.length);
            // console.log("[Crossings] len:", this.crossings.length, "avg:", (sum2 / this.crossings.length).toFixed(4), "max:", maxx2.toFixed(4), "min:", minn2.toFixed(4), "mid:", this.crossings[mid2].toFixed(4), "variance:", variance2.toFixed(4));

            if (this.tauList.length === 100 || this.tauList.length === 500) {
                // FileSaver.saveAs(new Blob([this.tauList.join("\n")], {type: "text/plain;charset=utf-8"}), 'tau.txt');
                // FileSaver.saveAs(new Blob([this.crossings.join("\n")], {type: "text/plain;charset=utf-8"}), 'crossings.txt');
                console.log(`[${this.tauList.length}-Kendall's Tau] Median:${median.toFixed(4)} Mean:${mean.toFixed(4)} Max:${maxx.toFixed(4)} Variance:${variance.toFixed(4)}`)
                console.log(`[${this.tauList.length}-Crossings    ] Median:${median2.toFixed(4)} Mean:${mean2.toFixed(4)} Max:${maxx2.toFixed(4)} Variance:${variance2.toFixed(4)}`)
            }
        }
    };

    calcSkips() {
        const A = this.orderedData[this.orderedData.length - 1];
        const B = this.orderedData[this.orderedData.length - 2];

        let skip = 0;
        for (let i = 0; i < A.length; i++) {
            for (let j = 0; j < B.length; j++) {
                if (A[i].TrackID === B[j].TrackID) {
                    skip += Math.abs(i - j);
                    break;
                }
            }
        }

        this.skips.push(skip)

        if (this.skips.length % 50 === 0) {
            const sum = this.skips.reduce((a, b) => a + b, 0);
            const mean = sum / this.skips.length;
            const maxx = Math.max(...this.skips);
            const minn = Math.min(...this.skips);
            const mid = Math.floor(this.skips.length / 2);
            const median = this.skips.sort((a, b) => a - b)[mid];
            const variance = Math.sqrt(this.skips.reduce((a, b) => a + (b - mean) ** 2, 0) / this.skips.length);
            // console.log("[SKIPS] len:", this.skips.length, "avg:", (sum / this.skips.length).toFixed(4), "max:", maxx.toFixed(4), "min:", minn.toFixed(4), "mid:", this.skips[mid].toFixed(4), "variance:", variance.toFixed(4));
            if (this.skips.length === 100 || this.skips.length === 500) {
                // FileSaver.saveAs(new Blob([this.skips.join("\n")], {type: "text/plain;charset=utf-8"}), 'skips.txt');
                console.log(`[${this.skips.length}-SKIPS        ] Median:${median.toFixed(4)} Mean:${mean.toFixed(4)} Max:${maxx.toFixed(4)} Variance:${variance.toFixed(4)}`)

                // const fenbu = new Array(100).fill(0);
                // for (let i = 0; i < this.skips.length; i++) {
                //     fenbu[this.skips[i]] += 1;
                // }
                // FileSaver.saveAs(new Blob([fenbu.join("\n")], {type: "text/plain;charset=utf-8"}), 'skips_fenbu.txt');
            }
        }
    }

    // 对这一frame的数据（这帧上的切片）进行排序
    getOrderedData(strategyName = "zOrder", frame = this.baseData.length - 1) {
        if (frame < 0 || frame >= this.baseData.length) {
            return;
        }
        if (this.orderedData[frame]) {
            return this.orderedData[frame];
        }

        if (strategyName === "zOrder") {
            this.zOrder(frame);
        } else if (strategyName === "hilbertOrder") {
            this.hilbertOrder(frame);
        } else if (strategyName === "geoHashOrder") {
            this.geoHashOrder(frame);
        } else if (strategyName === "s2Order") {
            this.s2Order(frame);
        } else if (strategyName === "mercatorOrder") {
            this.mercatorOrder(frame);
        }
    }

    zOrder(frame) {
        const zOrderIndex = (lat, lon, id = -1) => {
            const BITS = 20; // 索引值的位数
            const latInt = Math.floor(lat * 2 ** 20);
            const lonInt = Math.floor(lon * 2 ** 20);

            let index = 0;
            for (let i = 0; i < BITS / 2; i++) {
                // 每次取一位经纬度坐标的二进制位，并将其交替组合成一个32位整数
                const bitMask = 1 << (BITS - i * 2 - 1);
                const latBit = latInt & bitMask ? 1 : 0;
                const lonBit = lonInt & bitMask ? 1 : 0;
                const interleavedBits = (latBit << 1) | lonBit;
                index |= interleavedBits << (BITS - i * 2 - 2);
            }
            return index;
        }
        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return zOrderIndex(a.LatitudeGPS, a.LongitudeGPS, a.TrackID) - zOrderIndex(b.LatitudeGPS, b.LongitudeGPS, b.TrackID);
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    mercatorOrder(frame) {
        const mercatorIndex = (lat, lng) => {
            return grid.getGridIndex(lat, lng);
        }

        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return mercatorIndex(a.LatitudeGPS, a.LongitudeGPS) - mercatorIndex(b.LatitudeGPS, b.LongitudeGPS);
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    hilbertOrder(frame) {
        const hilbert2 = (x, y) => {
            function rot(n, x, y, rx, ry) {
                if (ry === 0) {
                    if (rx === 1) {
                        x = n - 1 - x;
                        y = n - 1 - y;
                    }
                    [x, y] = [y, x];
                }
                return [x, y];
            }

            x = Math.floor(((x - 30) / (40 - 30)) * 0xfffff);
            y = Math.floor(((y + 90) / (-80 + 90)) * 0xfffff);

            let rx = 0, ry = 0;

            let s = Math.floor(Math.log2(Math.max(x, y))) + 1;

            let d = 1 << (s - 1), index = 0;

            while (d > 0) {
                rx = (x & d) > 0 ? 1 : 0;
                ry = (y & d) > 0 ? 1 : 0;
                index += d * d * ((3 * rx) ^ ry);
                [x, y] = rot(d, x, y, rx, ry);
                d >>= 1;
            }
            return index;
        }

        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return hilbert2(a.LatitudeGPS, a.LongitudeGPS) - hilbert2(b.LatitudeGPS, b.LongitudeGPS);
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    geoHashOrder(frame) {
        const g2 = (latitude, longitude) => {
            return geo.encode(latitude, longitude, 10);
        }

        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return g2(a.LatitudeGPS, a.LongitudeGPS).localeCompare(g2(b.LatitudeGPS, b.LongitudeGPS));
        });

        this.orderedToID[frame] = this.orderedData[frame].map((d) => {
            return d.TrackID;
        });
    }

    s2Order(frame) {
        const s2 = (latitude, longitude) => {
            const ky = S2.latLngToKey(latitude, longitude, 20);
            return S2.keyToId(ky);
        }
        this.orderedData[frame] = this.baseData[frame].sort((a, b) => {
            return s2(a.LatitudeGPS, a.LongitudeGPS) - s2(b.LatitudeGPS, b.LongitudeGPS);
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
                // icon: L.icon({
                //     iconUrl: '/vite.svg',
                //     iconSize: [28, 28],
                // })
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
                <ul>
                    <li>
                        <a href="#motionRugsSet" role="tab" class="tab-icon">
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

                <div class="leaflet-sidebar-pane" id="motionRugsSet">
                    <h1 class="leaflet-sidebar-header">MotionRugs设置</h1>

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
