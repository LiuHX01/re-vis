class Grid {
    constructor(minLat, maxLat, minLng, maxLng, gridSize) {
        this.minLat = minLat;
        this.maxLat = maxLat;
        this.minLng = minLng;
        this.maxLng = maxLng;
        this.gridSize = gridSize;

        // 计算每度经纬度对应的米数
        const latCenter = (minLat + maxLat) / 2;
        const earthCircumferenceOnEquator = 6378137 * 2 * Math.PI;
        const metersPerDegreeAtEquator = earthCircumferenceOnEquator / 360;
        const metersPerDegreeAtLat = metersPerDegreeAtEquator * Math.cos((latCenter * Math.PI) / 180);
        this.metersPerGrid = metersPerDegreeAtLat * gridSize;

        // 网格编号从左上角开始，向右依次递增，行末到达边界后再从第一列开始新的一行
        this.rows = Math.ceil((maxLat - minLat) / gridSize);
        this.cols = Math.ceil((maxLng - minLng) / gridSize);
    }

    getGridIndex(lat, lng) {
        const x = Math.floor((lng - this.minLng) / this.gridSize);
        const y = Math.floor((lat - this.minLat) / this.gridSize);
        return y + x * this.rows;
    }

    getLatLngFromGridIndex(index) {
        const x = index % this.cols;
        const y = Math.floor(index / this.cols);
        const lat = this.minLat + y * this.gridSize;
        const lng = this.minLng + x * this.gridSize;
        return { lat, lng };
    }
}

const grid = new Grid(-90, 90.0, -180.0, 180.0, 0.00001);
export { grid }