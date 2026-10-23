import checkIcon from "@phosphor-icons/core/assets/regular/check.svg?raw";
import xIcon from "@phosphor-icons/core/assets/regular/x.svg?raw";
import plusIcon from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import gearIcon from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import caretDownIcon from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretRightIcon from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import caretLeftIcon from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import imageIcon from "@phosphor-icons/core/assets/regular/image.svg?raw";
import eyeIcon from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import arrowCounterClockwiseIcon from "@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw";
import minusIcon from "@phosphor-icons/core/assets/regular/minus.svg?raw";
import trashIcon from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import downloadSimpleIcon from "@phosphor-icons/core/assets/regular/download-simple.svg?raw";
import linkSimpleIcon from "@phosphor-icons/core/assets/regular/link-simple.svg?raw";
import squaresFourIcon from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import clockIcon from "@phosphor-icons/core/assets/regular/clock.svg?raw";
import cloudIcon from "@phosphor-icons/core/assets/regular/cloud.svg?raw";
import infoIcon from "@phosphor-icons/core/assets/regular/info.svg?raw";
import bugIcon from "@phosphor-icons/core/assets/regular/bug.svg?raw";
import uploadSimpleIcon from "@phosphor-icons/core/assets/regular/upload-simple.svg?raw";
import checkSquareIcon from "@phosphor-icons/core/assets/regular/check-square.svg?raw";
import imageBrokenIcon from "@phosphor-icons/core/assets/regular/image-broken.svg?raw";
import arrowUpIcon from "@phosphor-icons/core/assets/regular/arrow-up.svg?raw";
import arrowDownIcon from "@phosphor-icons/core/assets/regular/arrow-down.svg?raw";
import arrowClockwiseIcon from "@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw";
import globeIcon from "@phosphor-icons/core/assets/regular/globe.svg?raw";
import stackSimpleIcon from "@phosphor-icons/core/assets/regular/stack-simple.svg?raw";
import arrowsOutCardinalIcon from "@phosphor-icons/core/assets/regular/arrows-out-cardinal.svg?raw";
import paletteIcon from "@phosphor-icons/core/assets/regular/palette.svg?raw";
import paintBrushIcon from "@phosphor-icons/core/assets/regular/paint-brush.svg?raw";
import wavesIcon from "@phosphor-icons/core/assets/regular/waves.svg?raw";
import sparkleIcon from "@phosphor-icons/core/assets/regular/sparkle.svg?raw";
import playCircleIcon from "@phosphor-icons/core/assets/regular/play-circle.svg?raw";
import filmStripIcon from "@phosphor-icons/core/assets/regular/film-strip.svg?raw";
import starIcon from "@phosphor-icons/core/assets/regular/star.svg?raw";
import starFillIcon from "@phosphor-icons/core/assets/fill/star-fill.svg?raw";



function withSize(svg, size = 24, style = "") {
  return svg.replace(
    "<svg ",
    `<svg width="${size}" height="${size}"${style ? ` style="${style}"` : ""} `,
  );
}

export const Icons = {
  particleCheck: withSize(checkIcon, 14),
  particleX: withSize(xIcon, 14),
  plus: withSize(plusIcon, 16),
  close: withSize(xIcon),
  settings: withSize(gearIcon),
  chevronDown: withSize(caretDownIcon),
  chevronRight: withSize(caretRightIcon, 32),
  chevronLeft: withSize(caretLeftIcon, 18),
  preview: withSize(eyeIcon, 18),
  eye: withSize(eyeIcon, 18),
  reset: withSize(arrowCounterClockwiseIcon),
  sliderDec: withSize(minusIcon),
  sliderInc: withSize(plusIcon),
  collectionRemove: withSize(trashIcon, 16),
  collectionDownload: withSize(downloadSimpleIcon, 16),
  collectionSource: withSize(linkSimpleIcon, 16),
  manageCollection: withSize(stackSimpleIcon),
  sidebar_wallpaper: withSize(imageIcon),
  sidebar_appearance: withSize(paintBrushIcon),
  sidebar_widgets: withSize(squaresFourIcon),
  sidebar_time: withSize(clockIcon),
  sidebar_weather: withSize(cloudIcon),
  sidebar_info: withSize(infoIcon),
  sidebar_debug: withSize(bugIcon),
  upload: withSize(uploadSimpleIcon, 20),
  selectMode: withSize(checkSquareIcon, 20),
  bulkDelete: withSize(trashIcon, 20),
  emptyCollection: withSize(imageBrokenIcon, 32),
  particleUp: withSize(arrowUpIcon, 14),
  particleDown: withSize(arrowDownIcon, 14),
  particleSettings: withSize(gearIcon, 14),
  particleDelete: withSize(trashIcon, 14),
  weather: withSize(cloudIcon, 16),
  changeWallpaper: withSize(arrowClockwiseIcon, 20),
  arrowClockwise: withSize(arrowClockwiseIcon, 20),
  viewSource: withSize(linkSimpleIcon, 32),
  addToCollection: withSize(starIcon, 16),
  star: withSize(starIcon, 16),
  starFill: withSize(starFillIcon, 16),
  manageWallpaper: withSize(stackSimpleIcon, 32),
  language: withSize(globeIcon, 24, "transform: scale(1.2)"),
  exportSettings: withSize(uploadSimpleIcon, 32),
  importSettings: withSize(downloadSimpleIcon, 32),
  resetSettings: withSize(arrowCounterClockwiseIcon, 32),
  arrangeWallpaper: withSize(arrowsOutCardinalIcon, 18),
  filterSettings: withSize(paletteIcon, 18),
  wavySettings: withSize(wavesIcon, 18),
  parallaxSettings: withSize(arrowsOutCardinalIcon, 18),
  particlesSettings: withSize(sparkleIcon, 18),
  onloadSettings: withSize(playCircleIcon, 18),
  videoBadge: withSize(filmStripIcon, 16),
  imageBadge: withSize(imageIcon, 16),
  addMore: withSize(plusIcon, 40),
  image: withSize(imageIcon),
  collection: withSize(stackSimpleIcon),


};

export function renderIcons(rootNode = document) {
  const elements = rootNode.querySelectorAll("[data-icon]");
  elements.forEach((el) => {
    const iconName = el.getAttribute("data-icon");
    if (Icons[iconName]) {
      el.outerHTML = Icons[iconName];
    }
  });
}
