# Project Structure

```text
GlobeHop_3D_COMPLETE_PROJECT/
├─ .github/
│  └─ workflows/deploy.yml
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ DATA_GUIDE.md
│  ├─ PROJECT_STRUCTURE.md
│  └─ ROUTING_AND_PRIVACY.md
├─ public/
│  ├─ icons/
│  ├─ 404.html
│  ├─ favicon.svg
│  ├─ manifest.webmanifest
│  ├─ og-image.png
│  ├─ repo-social-preview.png
│  ├─ robots.txt
│  ├─ sitemap.xml
│  ├─ sw.js
│  └─ .nojekyll
├─ scripts/
│  ├─ build.mjs
│  └─ dev-server.mjs
├─ src/
│  ├─ data/
│  │  ├─ countries/
│  │  │  ├─ index.json
│  │  │  └─ regions/*.json
│  │  ├─ knowledge/*.json
│  │  ├─ origins/index.json
│  │  ├─ places/index.json
│  │  └─ world-geometries.json
│  ├─ modules/
│  │  ├─ config.js
│  │  ├─ dataService.js
│  │  ├─ geo.js
│  │  ├─ globe.js
│  │  ├─ globe3d.js
│  │  ├─ i18n.js
│  │  └─ storage.js
│  ├─ app.js
│  └─ styles.css
├─ index.html
├─ package.json
└─ README.md
```

## UI / Application

### `src/app.js`

서비스 전체 상태와 UI를 연결합니다.

- 검색
- 출발지
- 나라/도시 선택
- 2D/3D 전환
- map tooltip
- 클릭 여행
- 정보 카드
- 즐겨찾기
- 최근 탐험
- 외부 통계/도로 경로 보강

## Visualization

### `src/modules/globe.js`

SVG 2D 지도. 국가와 장소를 직접 눌러 이동할 수 있으며 여행 경로로 자동 줌됩니다.

### `src/modules/globe3d.js`

실제 WebGL 3D 지구본. 외부 CDN이나 Three.js가 없어도 프로젝트 자체 코드로 동작합니다.

- sphere mesh
- country texture
- drag rotation
- wheel/pinch zoom
- auto camera focus
- great-circle arc
- plane animation
- country picking
- place picking

## Data

### `countries/`

232개 국가의 검색 index와 대륙별 상세 shard.

### `places/`

2D/3D 지도에 표시하고 직접 클릭할 대표 도시·명소.

### `origins/`

출발 도시 preset. UI 수정 없이 JSON 추가로 확장.

### `knowledge/`

한 나라 = 한 JSON. 콘텐츠를 수천 건까지 단계적으로 늘리기 위한 분리 구조.
