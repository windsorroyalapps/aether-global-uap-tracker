export type Spectrum = "visible" | "infrared" | "geocolor";

export type CatalogCam = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "sky" | "traffic" | "airport" | "coast" | "space";
  network: string;
  snapshotPath: string;
  pageUrl: string;
  azimuth: number | null;
  viewKm: number;
  spectrum?: Spectrum;
};

function goes(
  sat: "16" | "18",
  path: string,
  id: string,
  name: string,
  lat: number,
  lng: number,
  viewKm: number,
  band = "GEOCOLOR",
  spectrum: Spectrum = "geocolor",
): CatalogCam {
  const host = `https://cdn.star.nesdis.noaa.gov/GOES${sat}/ABI/${path}/${band}/thumbnail.jpg`;
  return {
    id,
    name,
    lat,
    lng,
    kind: "space",
    network: "NOAA NESDIS",
    snapshotPath: host,
    pageUrl: `https://www.star.nesdis.noaa.gov/goes/index.php`,
    azimuth: null,
    viewKm,
    spectrum,
  };
}

/** Official public optical feeds only — weather, aviation, city, and wildfire cameras. */
export const CATALOG_CAMERAS: CatalogCam[] = [
  goes("16", "FD", "goes-east", "GOES-16 East full disk", 0, -75.2, 12000),
  goes("18", "FD", "goes-west", "GOES-18 West full disk", 0, -137.2, 12000),
  goes("16", "CONUS", "goes-east-conus", "GOES-16 CONUS", 38, -97, 4000),
  goes("18", "CONUS", "goes-west-conus", "GOES-18 CONUS West", 40, -118, 4000),
  goes("16", "SECTOR/ne", "goes-ne", "GOES-16 Northeast", 41.5, -72, 1600),
  goes("16", "SECTOR/se", "goes-se", "GOES-16 Southeast", 30, -82, 1600),
  goes("16", "SECTOR/cgl", "goes-cgl", "GOES-16 Great Lakes", 43, -86, 1400),
  goes("16", "SECTOR/car", "goes-car", "GOES-16 Caribbean", 18, -70, 1800),
  goes("16", "SECTOR/gm", "goes-gm", "GOES-16 Gulf of Mexico", 26, -90, 1600),
  goes("16", "SECTOR/pr", "goes-pr", "GOES-16 Puerto Rico", 18.2, -66.5, 900),
  goes("18", "SECTOR/hi", "goes-hi", "GOES-18 Hawaii", 21.3, -157.8, 1200),
  goes("18", "SECTOR/ak", "goes-ak", "GOES-18 Alaska", 64, -150, 1800),
  goes("16", "CONUS", "goes-east-ir", "GOES-16 CONUS IR 10.3 µm", 38, -97, 4000, "13", "infrared"),
  goes("18", "CONUS", "goes-west-ir", "GOES-18 CONUS IR 10.3 µm", 40, -118, 4000, "13", "infrared"),
  goes("16", "FD", "goes-east-ir-fd", "GOES-16 East IR full disk", 0, -75.2, 12000, "13", "infrared"),
  goes("18", "FD", "goes-west-ir-fd", "GOES-18 West IR full disk", 0, -137.2, 12000, "13", "infrared"),
  goes("16", "CONUS", "goes-east-swir", "GOES-16 CONUS shortwave IR", 38, -97, 4000, "07", "infrared"),
  goes("16", "SECTOR/ne", "goes-ne-ir", "GOES-16 Northeast IR", 41.5, -72, 1600, "13", "infrared"),
  goes("16", "SECTOR/se", "goes-se-ir", "GOES-16 Southeast IR", 30, -82, 1600, "13", "infrared"),
  goes("18", "SECTOR/hi", "goes-hi-ir", "GOES-18 Hawaii IR", 21.3, -157.8, 1200, "13", "infrared"),
  goes("18", "SECTOR/ak", "goes-ak-ir", "GOES-18 Alaska IR", 64, -150, 1800, "13", "infrared"),
  {
    id: "himawari",
    name: "Himawari-9 full disk",
    lat: 0,
    lng: 140.7,
    kind: "space",
    network: "JMA",
    snapshotPath: "https://www.data.jma.go.jp/mscweb/data/himawari/img/fd_/fd__trp.jpg",
    pageUrl: "https://www.data.jma.go.jp/mscweb/data/himawari/",
    azimuth: null,
    viewKm: 12000,
  },
  {
    id: "berlin-meteo",
    name: "Berlin Dahlem sky",
    lat: 52.457,
    lng: 13.315,
    kind: "sky",
    network: "FU Berlin",
    snapshotPath: "https://www.met.fu-berlin.de/wetter/webcam/webcam.jpg",
    pageUrl: "https://www.met.fu-berlin.de/wetter/",
    azimuth: 180,
    viewKm: 40,
  },
  {
    id: "hessdalen",
    name: "Hessdalen optical station",
    lat: 62.82,
    lng: 11.18,
    kind: "sky",
    network: "Hessdalen Project",
    snapshotPath: "https://www.hessdalen.org/station/hessdalen.jpg",
    pageUrl: "https://www.hessdalen.org/",
    azimuth: null,
    viewKm: 60,
  },
];

export const SNAPSHOT_HOSTS = new Set([
  "cdn.star.nesdis.noaa.gov",
  "www.data.jma.go.jp",
  "www.met.fu-berlin.de",
  "www.hessdalen.org",
  "cameras.alertcalifornia.org",
  "ops.alertcalifornia.org",
  "webcams.nyctmc.org",
  "cwwp2.dot.ca.gov",
  "jamcams.tfl.gov.uk",
  "s3-eu-west-1.amazonaws.com",
  "az511.com",
  "fl511.com",
  "511ga.org",
  "www.511pa.com",
  "511pa.com",
  "www.511ny.org",
  "511ny.org",
  "www.511wi.gov",
  "511wi.gov",
  "www.nvroads.com",
  "nvroads.com",
  "www.511.alaska.gov",
  "511.alaska.gov",
  "www.tripcheck.com",
  "tripcheck.com",
]);
