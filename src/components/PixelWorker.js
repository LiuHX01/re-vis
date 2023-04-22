class MotionRugsProcess {
    constructor() {
        this.baseData = [];
        this.lastFnum = -1; // 上一次的fNum
        this.bufBaseData = {}; // key: fNum, value: fData
        this.strategys = ["HilbertOrder"];
        this.features = ["Velocity"];
        // 每个key是feature-strategy str，value是一个列表，列表中的元素是一个对象，对象中包含了坐标、速度等信息
        this.orderedData = {};
        this.cnt = 0;
        this.redrawCnt = 1; // 每多少帧重绘一次

        this.pixelMaxWidth = 2000;

        this.deciles = {}; // 记录每个feature的deciles
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
    }

    newData(fData, fNum) {
        // 保证按序接收数据
        if (fNum !== this.lastFnum + 1) {
            // 说明当前帧不是连续的，先缓存起来
            this.bufBaseData[fNum] = fData;
            return;
        }
        this.lastFnum = fNum; // 说明当前帧是连续的，更新lastFnum
        while (this.bufBaseData[this.lastFnum + 1]) {
            // 说明有连续的帧，可以直接push进baseData
            this.lastFnum++;
            this.baseData.push(this.bufBaseData[this.lastFnum]);
            delete this.bufBaseData[this.lastFnum];
        }
        this.baseData.push(fData); // 把当前帧push进baseData

        while (this.baseData.length > this.pixelMaxWidth) {
            this.baseData.shift();
        }
        this.cnt++;
        if (this.cnt === this.redrawCnt) {
            this.cnt = 0;
            this.getOrderedData();
            this.getDeciles();
            this.generateImageData();
        }
    }

    getOrderedData() {
        this.strategys.forEach((strategy) => {
            if (strategy === "HilbertOrder") this.orderedData[strategy] = this.hilbertOrder();
            else if (strategy === "zOrder") this.orderedData[strategy] = this.zOrder();
        });
    }

    hilbertOrder() {
        const interleaveBits = (odd, even) => {
            let val = 0;
            let max = Math.max(odd, even);
            let n = 0;
            while (max > 0) {
                max = max >> 1;
                n++;
            }
            for (let i = 0; i < n; i++) {
                let bitMask = 1 << i;
                let a = (even & bitMask) > 0 ? 1 << (2 * i) : 0;
                let b = (odd & bitMask) > 0 ? 1 << (2 * i + 1) : 0;
                val += a + b;
            }
            return val;
        };

        const encode = (x, y, r) => {
            let mask = (1 << r) - 1;
            let hodd = 0;
            let heven = x ^ y;
            let notx = ~x & mask;
            let noty = ~y & mask;
            let temp = notx ^ y;

            let v0 = 0;
            let v1 = 0;
            for (let k = 1; k < r; k++) {
                v1 = ((v1 & heven) | ((v0 ^ noty) & temp)) >> 1;
                v0 = ((v0 & (v1 ^ notx)) | (~v0 & (v1 ^ noty))) >> 1;
            }
            hodd = (~v0 & (v1 ^ x)) | (v0 & (v1 ^ noty));
            return interleaveBits(hodd, heven);
        };

        let result = [];
        for (let x = 0; x < this.baseData.length; x++) {
            result[x] = [];
        }

        for (let x = 0; x < this.baseData.length; x++) {
            let idx = [];
            let hilbertValues = [];
            for (let y = 0; y < this.baseData[x].length; y++) {
                idx[y] = y;
                // 去除整数和小数点后第一位
                let tmpLat = 1000 * (this.baseData[x][y].LatitudeGPS * 10 - Math.floor(this.baseData[x][y].LatitudeGPS * 10));
                let tmpLng = 1000 * (this.baseData[x][y].LongitudeGPS * 10 - Math.floor(this.baseData[x][y].LongitudeGPS * 10));

                hilbertValues[y] = encode(Math.round(tmpLat), Math.round(tmpLng), 100);
            }
            idx.sort((a, b) => {
                return hilbertValues[a] - hilbertValues[b];
            });
            for (let y = 0; y < this.baseData[x].length; y++) {
                result[x][y] = this.baseData[x][idx[y]];
            }
        }

        return result;
    }

    zOrder() {
        const MortonTable256 = [
            0x0000, 0x0001, 0x0004, 0x0005, 0x0010, 0x0011, 0x0014, 0x0015, 0x0040, 0x0041, 0x0044, 0x0045, 0x0050, 0x0051, 0x0054, 0x0055, 0x0100,
            0x0101, 0x0104, 0x0105, 0x0110, 0x0111, 0x0114, 0x0115, 0x0140, 0x0141, 0x0144, 0x0145, 0x0150, 0x0151, 0x0154, 0x0155, 0x0400, 0x0401,
            0x0404, 0x0405, 0x0410, 0x0411, 0x0414, 0x0415, 0x0440, 0x0441, 0x0444, 0x0445, 0x0450, 0x0451, 0x0454, 0x0455, 0x0500, 0x0501, 0x0504,
            0x0505, 0x0510, 0x0511, 0x0514, 0x0515, 0x0540, 0x0541, 0x0544, 0x0545, 0x0550, 0x0551, 0x0554, 0x0555, 0x1000, 0x1001, 0x1004, 0x1005,
            0x1010, 0x1011, 0x1014, 0x1015, 0x1040, 0x1041, 0x1044, 0x1045, 0x1050, 0x1051, 0x1054, 0x1055, 0x1100, 0x1101, 0x1104, 0x1105, 0x1110,
            0x1111, 0x1114, 0x1115, 0x1140, 0x1141, 0x1144, 0x1145, 0x1150, 0x1151, 0x1154, 0x1155, 0x1400, 0x1401, 0x1404, 0x1405, 0x1410, 0x1411,
            0x1414, 0x1415, 0x1440, 0x1441, 0x1444, 0x1445, 0x1450, 0x1451, 0x1454, 0x1455, 0x1500, 0x1501, 0x1504, 0x1505, 0x1510, 0x1511, 0x1514,
            0x1515, 0x1540, 0x1541, 0x1544, 0x1545, 0x1550, 0x1551, 0x1554, 0x1555, 0x4000, 0x4001, 0x4004, 0x4005, 0x4010, 0x4011, 0x4014, 0x4015,
            0x4040, 0x4041, 0x4044, 0x4045, 0x4050, 0x4051, 0x4054, 0x4055, 0x4100, 0x4101, 0x4104, 0x4105, 0x4110, 0x4111, 0x4114, 0x4115, 0x4140,
            0x4141, 0x4144, 0x4145, 0x4150, 0x4151, 0x4154, 0x4155, 0x4400, 0x4401, 0x4404, 0x4405, 0x4410, 0x4411, 0x4414, 0x4415, 0x4440, 0x4441,
            0x4444, 0x4445, 0x4450, 0x4451, 0x4454, 0x4455, 0x4500, 0x4501, 0x4504, 0x4505, 0x4510, 0x4511, 0x4514, 0x4515, 0x4540, 0x4541, 0x4544,
            0x4545, 0x4550, 0x4551, 0x4554, 0x4555, 0x5000, 0x5001, 0x5004, 0x5005, 0x5010, 0x5011, 0x5014, 0x5015, 0x5040, 0x5041, 0x5044, 0x5045,
            0x5050, 0x5051, 0x5054, 0x5055, 0x5100, 0x5101, 0x5104, 0x5105, 0x5110, 0x5111, 0x5114, 0x5115, 0x5140, 0x5141, 0x5144, 0x5145, 0x5150,
            0x5151, 0x5154, 0x5155, 0x5400, 0x5401, 0x5404, 0x5405, 0x5410, 0x5411, 0x5414, 0x5415, 0x5440, 0x5441, 0x5444, 0x5445, 0x5450, 0x5451,
            0x5454, 0x5455, 0x5500, 0x5501, 0x5504, 0x5505, 0x5510, 0x5511, 0x5514, 0x5515, 0x5540, 0x5541, 0x5544, 0x5545, 0x5550, 0x5551, 0x5554,
            0x5555,
        ];

        const encode = (x, y) => {
            let res = 0;
            res = (MortonTable256[y >> 8] << 17) | (MortonTable256[x >> 8] << 16) | (MortonTable256[y & 0xff] << 1) | MortonTable256[x & 0xff];
            return res;
        };

        let result = [];
        for (let x = 0; x < this.baseData.length; x++) {
            result[x] = [];
        }

        for (let x = 0; x < this.baseData.length; x++) {
            let idx = [];
            let zValues = [];

            for (let y = 0; y < this.baseData[x].length; y++) {
                idx[y] = y;

                let tmpLat = 1000 * (this.baseData[x][y].LatitudeGPS * 10 - Math.floor(this.baseData[x][y].LatitudeGPS * 10));
                let tmpLng = 1000 * (this.baseData[x][y].LongitudeGPS * 10 - Math.floor(this.baseData[x][y].LongitudeGPS * 10));
                zValues[y] = encode(Math.round(tmpLat), Math.round(tmpLng));
            }

            idx.sort((a, b) => {
                return zValues[a] - zValues[b];
            });

            for (let y = 0; y < this.baseData[x].length; y++) {
                result[x][y] = this.baseData[x][idx[y]];
            }
        }
        return result;
    }

    getDeciles() {
        this.features.forEach((feature) => {
            this.deciles[feature] = [];
            let values = [];
            this.strategys.forEach((strategy) => {
                this.orderedData[strategy].forEach((frame) => {
                    frame.forEach((item) => {
                        values.push(parseFloat(item[feature]));
                    });
                });
            });
            values.sort((a, b) => {
                return a - b;
            });
            for (let i = 1; i < 10; i++) {
                const index = Math.floor((i / 10) * values.length);
                this.deciles[feature][i] = values[index];
            }
        });
    }

    hex2rgb(hex) {
        let rgb = [];
        for (let i = 1; i < 7; i += 2) {
            rgb.push(parseInt("0x" + hex.slice(i, i + 2)));
        }
        return rgb;
    }

    // 根据feature和value得到对应的颜色
    getFeatureColor(feature, value) {
        let i = 0;
        for (i; i < this.deciles[feature].length; i++) {
            if (value > this.deciles[feature][i] && value <= this.deciles[feature][i + 1]) {
                return this.colors[i];
            }
        }
        return this.colors[this.colors.length - 1];
    }

    generateImageData() {
        // 对于每一种feature-strategy组合，都生成一张图片
        this.strategys.forEach((strategy) => {
            this.features.forEach((feature) => {
                let height = this.orderedData[strategy][0].length;
                let width = this.orderedData[strategy].length;
                let imageData = new ImageData(width, height);
                // strategy: HilbertOrder, feature: Velocity, width: 5, height: 14
                for (let x = 0; x < width; x++) {
                    for (let y = 0; y < height; y++) {
                        let color = this.getFeatureColor(feature, parseFloat(this.orderedData[strategy][x][y][feature]));
                        this.orderedData[strategy][x][y].colorIdx = this.colors.indexOf(color);
                        color = this.hex2rgb(color)
                        const idx = 4 * (x + y * width);
                        imageData.data[idx] = color[0];
                        imageData.data[idx + 1] = color[1];
                        imageData.data[idx + 2] = color[2];
                        imageData.data[idx + 3] = 255;
                    }
                }
                postMessage({
                    strategy: strategy,
                    feature: feature,
                    imgData: imageData,
                    orderedData: this.orderedData[strategy],
                });
            });
        });
    }
}

const motionRugsProcess = new MotionRugsProcess();

onmessage = (e) => {
    const {fData, fNum, width} = e.data;

    motionRugsProcess.newData(fData, fNum);
    motionRugsProcess.pixelMaxWidth = parseInt((width) / 4);
};
