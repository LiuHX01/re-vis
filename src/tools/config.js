const Config = {
    MoverNum: 14,
    DataSet: "I24", // ZTD I24

    Duration: 200,

    Strategy: "s2Order", // [hilbert z mercator geoHash s2] + Order
    Feature: "Velocity", // Velocity Acceleration

    timerOpen: false,
    downloadOpen: false,
    calcOpen: false,
    startImmediately: true,

    defaultColors: ["#313695", "#4575B4", "#74ADD1", "#ABD9E9", "#E0F3F8", "#FEE090", "#FDAE61", "#F46D43", "#D73027", "#A50026"],
};

export { Config };
