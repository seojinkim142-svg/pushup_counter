# 운동 횟수 카운터 (푸시업 · 스쿼트)

전면(또는 후면) 카메라로 자세를 인식해서 푸시업/스쿼트 횟수를 자동으로 세는 앱입니다.
화면 상단 탭에서 종목을 전환할 수 있습니다.
온디바이스 포즈 추정(MediaPipe Pose Landmarker)을 사용하므로 인터넷 연결이 필요 없고,
영상은 기기 밖으로 전송되지 않습니다.

## 동작 방식

1. `react-native-vision-camera`가 카메라 프리뷰를 제공하고, `react-native-mediapipe`가
   `MediapipeCamera` 컴포넌트를 통해 실시간(`RunningMode.LIVE_STREAM`)으로 프레임을 분석합니다.
2. MediaPipe Pose Landmarker의 `pose_landmarker_lite` 모델(CPU delegate, 15fps 상한)이
   프레임마다 33개 관절 좌표를 반환합니다 (`src/components/CameraScreen.tsx`의 `onResults`).
3. 선택된 종목에 따라 서로 다른 신호로 반복을 감지합니다 (`src/lib/pose.ts`의 `EXERCISES`).
   - **푸시업** (`verticalDisplacement` 신호): 정면에서는 팔꿈치 각도가 카메라 쪽으로
     원근 왜곡되어 흔들리므로, 대신 양쪽 어깨의 평균 수직 위치(y)를 추적합니다.
     `VerticalRepCounter`가 One-Euro 필터로 노이즈를 줄이고, 관찰된 최소/최대 범위의
     70%/30% 지점을 넘나드는 것으로 반복을 자가보정 방식으로 감지합니다(고정 픽셀
     임계값이 없어 사람마다/거리마다 다시 맞출 필요가 없음). 손목이 어깨보다 충분히
     아래에 있어야(`isValidPosture`) 카운트가 진행됩니다.
   - **스쿼트** (`sideAngle` 신호): 옆에서 보면 허벅지·정강이가 원근 왜곡되지 않으므로
     고관절-무릎-발목 각도를 직접 사용합니다. `SideAngleRepCounter`가 매 프레임 더 잘
     보이는 쪽 다리를 자동으로 선택하고, 관찰된 각도 범위로 임계값을 자가보정하며
     (범위가 충분히 쌓이기 전에는 고정 fallback 값 사용), 실제로 충분히 앉았을 때만
     반복으로 인정합니다.
4. 관절과 뼈대는 카메라 화면 위에 SVG로 실시간으로 그려집니다(신뢰도가 낮은 관절은 숨김).

## 중요: Expo Go로는 실행할 수 없어요

이 앱은 카메라 프레임에 직접 접근하는 네이티브 모듈(`react-native-vision-camera`,
`react-native-mediapipe`)을 사용하기 때문에 **Expo Go 앱으로는 실행되지 않습니다.**
아래처럼 커스텀 개발 빌드(Dev Client)를 만들어야 합니다.

### 사전 준비

- Android: Android Studio + SDK (에뮬레이터 또는 실기기)
- iOS: macOS + Xcode (실기기 또는 시뮬레이터, 시뮬레이터는 카메라가 없어 실기기 권장)

### 실행

```sh
npm install

# 네이티브 프로젝트 생성 (최초 1회, 또는 네이티브 설정 변경 시)
npx expo prebuild

# Android
npx expo run:android

# iOS (macOS 필요)
npx expo run:ios
```

`plugins/withMediaPipeModel.js` 설정 플러그인이 `assets/models/pose_landmarker_lite.task`
모델 파일을 매 prebuild마다 네이티브 프로젝트(Android assets / iOS 번들 리소스)로
복사하므로, 모델을 따로 옮길 필요는 없습니다.

기기에 최초 설치 후에는 `npx expo start`로 JS만 다시 로드하며 개발할 수 있습니다.

## 사용법

- 앱 실행 후 카메라 권한을 허용하세요.
- 상단 탭에서 "푸시업" 또는 "스쿼트"를 선택하세요 (전환 시 카운트는 0으로 초기화됩니다).
- **푸시업**: 휴대폰을 바닥이나 벽에 세워, 손을 바닥에 짚고 엎드린 자세로 몸통과 팔이
  화면 정중앙 사각형 안에 들어오게 하세요.
- **스쿼트**: 카메라 옆쪽에 서서 엉덩이·무릎·발목이 모두 화면에 보이도록 휴대폰을
  좀 더 멀리 두거나 낮게 세워주세요.
- 동작을 하면 화면의 초록색 뼈대가 관절을 따라 움직이고, 좌측의 게이지가 얼마나
  깊이 내려갔는지 보여줍니다. 처음 한두 번의 반복 동안 범위가 자동으로 보정됩니다.
- 우측 상단 버튼으로 전/후면 카메라를 전환할 수 있습니다.
- "일시정지"로 카운트를 멈추고, "초기화"로 0부터 다시 시작할 수 있습니다.

## 카운팅 정확도 튜닝

`src/lib/pose.ts`의 `EXERCISES` 객체와 각 신호별 카운터 클래스에서 조정 가능합니다.

- `MIN_KEYPOINT_SCORE`: 관절 인식 신뢰도 최소값. 조명이 어둡거나 카메라가 멀면 값을 낮춰보세요.
- `VerticalRepCounter`(푸시업)의 `DOWN_NORM_THRESHOLD` / `UP_NORM_THRESHOLD`,
  `MIN_CALIBRATION_RANGE`: 자가보정된 범위 중 몇 %를 "완전히 내려감"/"완전히 올라옴"으로
  볼지, 그리고 보정을 시작하기 위한 최소 관찰 범위.
- `SideAngleRepCounter`(스쿼트)의 `SIDE_ANGLE_*_FRACTION`, `SIDE_ANGLE_*_FALLBACK`,
  `SIDE_ANGLE_MIN_CALIBRATION_RANGE`: 자가보정 임계값 비율과, 범위가 충분히 쌓이기 전에
  쓰는 고정 각도(도 단위).
- 새 종목을 추가하려면 `EXERCISES`에 항목을 하나 더 넣고, 세 가지 신호 타입
  (`angle` / `verticalDisplacement` / `sideAngle`) 중 적합한 것을 골라 설정하면 됩니다.

## 폴더 구조

```
App.tsx                              앱 진입점
src/components/CameraScreen.tsx      카메라 + 포즈 추정 + 카운터 UI
src/lib/pose.ts                      관절 인덱스, 각도/변위 계산, 종목별 설정, 카운터 클래스
src/lib/oneEuroFilter.ts             관절 좌표 노이즈 제거용 One-Euro 필터
plugins/withMediaPipeModel.js        prebuild 시 모델 파일을 네이티브 프로젝트로 복사하는 config 플러그인
assets/models/pose_landmarker_lite.task  온디바이스 포즈 추정 모델
```
