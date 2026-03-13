// -----------------------------
// AgriGuardian Experiment 1
// Mbarara NDVI setup
// -----------------------------

var mbarara = ee.Geometry.Rectangle([30.35, -0.85, 30.95, -0.15]);

Map.setCenter(30.65, -0.50, 9);
Map.addLayer(mbarara, {color: 'red'}, 'Mbarara AOI');

var startDate = '2020-01-01';
var endDate   = '2024-12-31';

// Load Sentinel-2 imagery
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(mbarara)
  .filterDate(startDate, endDate)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30));

print('Sentinel-2 collection', s2);

// Cloud masking
function maskS2clouds(image) {
  var qa = image.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask)
    .divide(10000)
    .copyProperties(image, ['system:time_start']);
}

// Add NDVI
function addNDVI(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return image.addBands(ndvi);
}

var s2Ndvi = s2.map(maskS2clouds).map(addNDVI);

print('Sentinel-2 with NDVI', s2Ndvi);

// Median NDVI map
var ndviMedian = s2Ndvi.select('NDVI').median().clip(mbarara);

Map.addLayer(
  ndviMedian,
  {min: 0, max: 1, palette: ['brown', 'yellow', 'green']},
  'Median NDVI 2020-2024'
);

print('Median NDVI image', ndviMedian);

// NDVI chart
var ndviChart = ui.Chart.image.series(
  s2Ndvi.select('NDVI'),
  mbarara,
  ee.Reducer.mean(),
  250,
  'system:time_start'
).setOptions({
  title: 'NDVI Time Series for Mbarara',
  hAxis: {title: 'Date'},
  vAxis: {title: 'Mean NDVI'},
  lineWidth: 1,
  pointSize: 2
});

print(ndviChart);

// Create monthly NDVI composites
var years = ee.List.sequence(2020, 2024);
var months = ee.List.sequence(1, 12);

var monthlyNdvi = ee.ImageCollection.fromImages(
  years.map(function(y) {
    return months.map(function(m) {
      var start = ee.Date.fromYMD(y, m, 1);
      var end = start.advance(1, 'month');

      var img = s2Ndvi
        .filterDate(start, end)
        .select('NDVI')
        .median()
        .clip(mbarara)
        .set('system:time_start', start.millis())
        .set('year', y)
        .set('month', m);

      return img;
    });
  }).flatten()
);

var monthlyChart = ui.Chart.image.series(
  monthlyNdvi,
  mbarara,
  ee.Reducer.mean(),
  250,
  'system:time_start'
).setOptions({
  title: 'Monthly Median NDVI for Mbarara',
  hAxis: {title: 'Date'},
  vAxis: {title: 'Mean NDVI'},
  lineWidth: 2,
  pointSize: 3
});

print(monthlyChart);

// Load CHIRPS daily rainfall data
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(mbarara)
  .filterDate(startDate, endDate);

print('CHIRPS rainfall collection', chirps);

// Create monthly rainfall totals
var monthlyRain = ee.ImageCollection.fromImages(
  years.map(function(y) {
    return months.map(function(m) {
      var start = ee.Date.fromYMD(y, m, 1);
      var end = start.advance(1, 'month');

      var img = chirps
        .filterDate(start, end)
        .sum()
        .rename('rainfall')
        .clip(mbarara)
        .set('system:time_start', start.millis())
        .set('year', y)
        .set('month', m);

      return img;
    });
  }).flatten()
);

print('Monthly rainfall collection', monthlyRain);

var rainChart = ui.Chart.image.series(
  monthlyRain,
  mbarara,
  ee.Reducer.mean(),
  5000,
  'system:time_start'
).setOptions({
  title: 'Monthly Rainfall for Mbarara',
  hAxis: {title: 'Date'},
  vAxis: {title: 'Rainfall (mm)'},
  lineWidth: 2,
  pointSize: 3
});

print(rainChart);

// Build combined monthly NDVI + rainfall feature table
// Build combined monthly NDVI + rainfall feature table safely
var monthlyFeatures = ee.FeatureCollection(
  years.map(function(y) {
    return months.map(function(m) {
      var start = ee.Date.fromYMD(y, m, 1);
      var end = start.advance(1, 'month');

      var ndviImg = ee.Image(monthlyNdvi.filterDate(start, end).first());
      var rainImg = ee.Image(monthlyRain.filterDate(start, end).first());

      var ndviDict = ndviImg.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: mbarara,
        scale: 250,
        maxPixels: 1e13,
        bestEffort: true
      });

      var rainDict = rainImg.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: mbarara,
        scale: 5000,
        maxPixels: 1e13,
        bestEffort: true
      });

      var ndviMean = ee.Algorithms.If(
        ndviDict.contains('NDVI'),
        ndviDict.get('NDVI'),
        -9999
      );

      var rainMean = ee.Algorithms.If(
        rainDict.contains('rainfall'),
        rainDict.get('rainfall'),
        -9999
      );

      return ee.Feature(null, {
        date: start.format('YYYY-MM'),
        year: y,
        month: m,
        mean_ndvi: ndviMean,
        monthly_rainfall: rainMean
      });
    });
  }).flatten()
);

print('Combined monthly feature table', monthlyFeatures.limit(12));

Export.table.toDrive({
  collection: monthlyFeatures,
  description: 'AgriGuardian_Mbarara_Monthly_NDVI_Rainfall_2020_2024',
  fileFormat: 'CSV'
});