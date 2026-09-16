import { X, Settings, ChevronDown, ChevronRight, ChevronLeft, EyeOff, RotateCcw, Minus, Plus, Trash, Download, Link, Image, Layout, Layers, Clock, Cloud, Info, Bug, Upload, CheckSquare, Trash2, ImageOff, ArrowUp, ArrowDown, RefreshCcw, Globe, GalleryVerticalEnd, MirrorRectangular, Move, Palette, Waves, Sparkles, PlayCircle, Film , Check} from 'lucide';

function toSvgString(iconNode, attrs = {}) {
    const defaultAttrs = {
        xmlns: 'http://www.w3.org/2000/svg',
        width: 24,
        height: 24,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        ...attrs
    };
    const attrString = Object.entries(defaultAttrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    const childrenString = iconNode.map(([tag, childAttrs]) => {
        const childAttrString = Object.entries(childAttrs).map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<${tag} ${childAttrString} />`;
    }).join('');
    return `<svg ${attrString}>${childrenString}</svg>`;
}

export const Icons = {
    particleCheck: toSvgString(Check, { width: 14, height: 14 }),
    particleX: toSvgString(X, { width: 14, height: 14 }),
    plus: toSvgString(Plus, { width: 16, height: 16 }),
    close: toSvgString(X),
    settings: toSvgString(Settings),
    chevronDown: toSvgString(ChevronDown),
    chevronRight: toSvgString(ChevronRight, { width: 32, height: 32 }),
    chevronLeft: toSvgString(ChevronLeft, { width: 18, height: 18 }),
    preview: toSvgString(Image, { width: 18, height: 18 }),
    eye: toSvgString(Image, { width: 18, height: 18 }),
    reset: toSvgString(RotateCcw),
    sliderDec: toSvgString(Minus),
    sliderInc: toSvgString(Plus),
    collectionRemove: toSvgString(Trash, { width: 16, height: 16 }),
    collectionDownload: toSvgString(Download, { width: 16, height: 16 }),
    collectionSource: toSvgString(Link, { width: 16, height: 16 }),
    manageCollection: toSvgString(GalleryVerticalEnd),
    sidebar_wallpaper: toSvgString(Image),
    sidebar_appearance: toSvgString(Layout),
    sidebar_widgets: toSvgString(MirrorRectangular),
    sidebar_time: toSvgString(Clock),
    sidebar_weather: toSvgString(Cloud),
    sidebar_info: toSvgString(Info),
    sidebar_debug: toSvgString(Bug),
    upload: toSvgString(Upload, { width: 20, height: 20 }),
    selectMode: toSvgString(CheckSquare, { width: 20, height: 20 }),
    bulkDelete: toSvgString(Trash2, { width: 20, height: 20 }),
    emptyCollection: toSvgString(ImageOff, { width: 32, height: 32 }),
    particleUp: toSvgString(ArrowUp, { width: 14, height: 14 }),
    particleDown: toSvgString(ArrowDown, { width: 14, height: 14 }),
    particleSettings: toSvgString(Settings, { width: 14, height: 14 }),
    particleDelete: toSvgString(Trash, { width: 14, height: 14 }),
    weather: toSvgString(Cloud, { width: 16, height: 16 }),
    changeWallpaper: toSvgString(RefreshCcw, { width: 20, height: 20 }),
    viewSource: toSvgString(Link, { width: 32, height: 32 }),
    addToCollection: toSvgString(Plus, { width: 20, height: 20 }),
    manageWallpaper: toSvgString(GalleryVerticalEnd, { width: 32, height: 32 }),
    language: toSvgString(Globe, { style: 'transform: scale(1.2)' }),
    exportSettings: toSvgString(Upload, { width: 32, height: 32 }),
    importSettings: toSvgString(Download, { width: 32, height: 32 }),
    resetSettings: toSvgString(RotateCcw, { width: 32, height: 32 }),
    arrangeWallpaper: toSvgString(Move, { width: 18, height: 18 }),
    filterSettings: toSvgString(Palette, { width: 18, height: 18 }),
    wavySettings: toSvgString(Waves, { width: 18, height: 18 }),
    parallaxSettings: toSvgString(Move, { width: 18, height: 18 }),
    particlesSettings: toSvgString(Sparkles, { width: 18, height: 18 }),
    onloadSettings: toSvgString(PlayCircle, { width: 18, height: 18 }),
    videoBadge: toSvgString(Film, { width: 16, height: 16 }),
    imageBadge: toSvgString(Image, { width: 16, height: 16 }),
    // Wallpaper Switcher: trailing "load one more" card
    addMore: toSvgString(Plus, { width: 40, height: 40 })
};

export function renderIcons(rootNode = document) {
    const elements = rootNode.querySelectorAll("[data-icon]");
    elements.forEach(el => {
        const iconName = el.getAttribute("data-icon");
        if (Icons[iconName]) {
            el.outerHTML = Icons[iconName];
        }
    });
}
