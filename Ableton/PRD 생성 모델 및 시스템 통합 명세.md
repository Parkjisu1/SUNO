# PRD: 생성 모델 및 시스템 통합 명세

## 문서 위치

```
message.txt          → 전체 제품 비전, 아키텍처 개요, 사용자 시나리오
환각수정v10.json      → 화성 분석 엔진 규칙 DB + 노트태깅 + 패턴표현 + DB스키마
이 문서               → 생성 모델 설계, 학습, 추론, 평가, MVP, 사용자 제어
```

이 세 문서가 합쳐져야 **제품 전체 PRD**가 완성된다.

---

# 1. 생성 모델 아키텍처 선택

## 1-1. 세 가지 방향과 판단

| 방향 | 핵심 | 장점 | 단점 | 적합 시점 |
|------|------|------|------|-----------|
| A. Retrieval + Rearrangement | DB에서 유사 패턴 검색 → 화성엔진이 새 코드에 매핑 | 데이터 적어도 동작, 결과가 자연스러움, 디버깅 쉬움 | 완전 새로운 패턴 생성 불가, DB 크기에 의존 | **MVP (Phase 3)** |
| B. Sequence Generation | Transformer 계열 모델이 상대 패턴 시퀀스를 직접 생성 | 창의적 변형 가능, DB에 없는 패턴도 생성 | 대량 데이터 필요, 화성 정합성 불안정 | Phase 4 |
| C. Hybrid | Retrieval로 후보 가져오고 → 생성 모델이 variation → 화성엔진이 보정 | 세 가지 장점을 동시에 가짐 | 가장 복잡, 세 모듈 모두 완성 필요 | Phase 5 (최종) |

### 결정

**MVP는 방향 A로 시작한다.** 이유:

1. 화성엔진이 핵심이다. 생성 모델이 아무리 좋아도 화성엔진 없으면 코드 정합성 보장 불가.
2. Retrieval은 데이터 50~200개 패턴으로도 시작 가능.
3. 방향 A가 동작하면 그 위에 B, C를 점진적으로 올릴 수 있다.
4. 방향 A의 결과물이 방향 B의 학습 데이터 품질 검증 도구가 된다.

---

# 2. Phase별 생성 전략 상세

## 2-1. Phase 3: Retrieval + Rearrangement (MVP)

### 개념

```
사용자 입력:
  코드 진행: [Dm7, G7, Cmaj7, Am7]
  스타일: jazz
  밀도: medium
  길이: 4마디

시스템 동작:
  1. 패턴 DB에서 조건 매칭 검색
  2. 후보 패턴 N개 반환 (유사도 순)
  3. 사용자 선택 또는 자동 선택
  4. 화성엔진이 패턴을 사용자 코드 진행에 재배치
  5. 후처리
  6. MIDI 출력
```

### 검색 로직

```
검색 조건 (AND 조합, 가중치 매칭):
  1. chord_quality 시퀀스 유사도 (최우선)
     - 원본 패턴의 코드 품질 시퀀스와 입력의 코드 품질 시퀀스를 비교
     - 예: [m7, 7, maj7, m7]는 ii-V-I-vi 패턴과 매칭
     - 완전 일치 아니어도 됨: 품질 유사도 점수화
       - m7 ↔ m7 = 1.0
       - m7 ↔ m9 = 0.9
       - m7 ↔ m7b5 = 0.7
       - m7 ↔ maj7 = 0.2

  2. 리듬 패턴 해시 유사도 (2순위)
     - 피치 무시하고 리듬만 비교
     - onset 시퀀스의 해시 비교 또는 edit distance

  3. 스타일/장르 필터 (3순위)
     - genre = 'jazz' AND style = 'swing'

  4. 밀도 필터
     - 분당 음표 수 또는 마디당 음표 수 범위

  5. 보이싱 타입 필터 (선택)
     - shell, rootless, spread 등

  6. 템포 범위 필터 (선택)
```

### 검색 결과 랭킹

```python
score = (
    0.40 * chord_quality_sequence_similarity +
    0.25 * rhythm_pattern_similarity +
    0.15 * style_match_score +
    0.10 * density_match_score +
    0.05 * voicing_type_match_score +
    0.05 * tempo_range_match_score
)
```

### 재배치 알고리즘 (Rearrangement)

환각수정v10.json의 `relative_pattern_representation.rearrangement_algorithm` 참조.
여기서는 구체적인 엣지케이스 처리를 추가한다.

```
입력: source_pattern (상대 표현), target_chords (코드 진행)

for each chord_segment in target_chords:
    source_segment = source_pattern[segment_index]

    for each note in source_segment.relative_notes:

        # Step 1: 구조적 코드톤 매핑
        if note.role_tag in [ROOT, THIRD, FIFTH, SEVENTH]:
            target_pitch = map_chord_degree(
                degree=note.chord_degree,
                target_chord=chord_segment,
                target_quality=chord_segment.quality
            )

        # Step 2: 텐션 매핑 (코드-스케일 확인 필수)
        elif note.role_tag in [T9, T11, T13]:
            if tension_available_in_target(note.chord_degree, chord_segment):
                target_pitch = map_tension(note.chord_degree, chord_segment)
            else:
                # 대체 전략: 가장 가까운 허용 텐션으로 교체
                target_pitch = find_nearest_available_tension(
                    note.chord_degree, chord_segment
                )
                # 대체 불가 시: 해당 음의 리듬 값을 인접 구조음에 재분배
                if target_pitch is None:
                    redistribute_to_adjacent_structural_note(note)
                    continue

        # Step 3: 비화성음 매핑 (관계 보존)
        elif note.role_tag == PASSING:
            # 이전 음과 다음 음의 매핑된 피치 사이를 순차 연결
            target_pitch = calculate_passing_tone(
                prev_mapped_pitch, next_mapped_pitch,
                original_direction=note.direction
            )

        elif note.role_tag == NEIGHBOR:
            # 장식 대상 음의 매핑된 피치에서 반음 또는 온음 이동
            target_pitch = calculate_neighbor(
                anchor_mapped_pitch,
                original_interval=note.interval_from_anchor
            )

        elif note.role_tag == APPROACH:
            # 타깃 코드톤의 매핑된 피치에서 반음 아래/위
            target_pitch = calculate_approach(
                target_chord_tone_mapped_pitch,
                approach_type=note.approach_type  # chromatic_below, diatonic_above, etc.
            )

        # Step 4: 옥타브 배치
        target_pitch = apply_octave_offset(target_pitch, note.octave_offset)

        # Step 5: 타이밍 복원
        onset = quantized_position + note.timing_offset_ms

        # Step 6: 벨로시티
        velocity = note.velocity_normalized * style_velocity_curve(chord_segment.style)

    # Step 7: 후처리 검증
    validate_playability(mapped_notes)
    validate_register(mapped_notes)
    validate_no_mud_clusters(mapped_notes)
    resolve_voice_crossing(mapped_notes)
```

### 재배치 엣지케이스

| 상황 | 처리 |
|------|------|
| 원본 m7 → 타깃 maj7 | b3→3, b7→7 매핑. 리딩톤 해결 방향 반전 가능 |
| 원본 7 → 타깃 m7b5 | 3→b3, 5→b5, b7→b7. 아보이드노트 체크 |
| 원본 4마디 → 타깃 2마디 | 패턴 전반부만 사용 또는 리듬 압축 |
| 원본 코드 2개 → 타깃 코드 4개 | 패턴을 반복하되 두 번째 반복에 variation 적용 |
| 텐션 #11 가용 → 타깃에서 불가 | 가장 가까운 가용 텐션(9 또는 13)으로 대체 |
| 원본에 페달톤 있음 | 타깃 키의 토닉 또는 도미넌트 페달로 이식 |

---

## 2-2. Phase 4: Sequence Generation Model

### 모델 아키텍처

**Transformer Decoder (GPT 계열)** 선택 이유:
- 시퀀스-to-시퀀스 생성에 최적
- 조건부 생성(conditioning)이 자연스러움
- 음악 도메인에서 검증됨 (Music Transformer, MusicLM 등)

```
모델 규모 (MVP):
  - Layers: 6~8
  - Heads: 8
  - d_model: 512
  - Context length: 2048 tokens (약 8마디 커버)
  - Parameters: ~30M (작은 모델로 시작)

입력 토큰 구조:
  [CHORD_START] [chord_quality] [CHORD_END]
  [NOTE] [role_tag] [degree] [octave] [duration] [velocity] [position]
  [NOTE] ...
  [BAR]
  [CHORD_START] ...
```

### 학습 목표 (Loss / Objective)

```
Primary Loss: Cross-entropy on next-token prediction
  L_primary = -Σ log P(token_t | token_1...t-1, conditioning)

Auxiliary Losses (multi-task):
  L_chord_consistency:
    매 chord segment마다 생성된 노트의 코드톤 비율 검증
    코드톤 비율이 threshold 이하면 페널티
    weight: 0.15

  L_voice_leading:
    인접 chord segment 간 top-note/inner-voice 이동 거리 페널티
    큰 도약일수록 페널티 증가
    weight: 0.10

  L_rhythm_diversity:
    연속 마디의 리듬 패턴이 완전 동일하면 페널티 (기계적 반복 방지)
    weight: 0.05

Total Loss:
  L = L_primary + λ1 * L_chord_consistency + λ2 * L_voice_leading + λ3 * L_rhythm_diversity
  초기 λ: [0.15, 0.10, 0.05]
  학습 진행에 따라 스케줄링 가능
```

### Conditioning Format (조건부 입력)

```
생성 모델에 주어지는 조건부 입력:

1. Chord Progression Tokens (필수)
   [CHORD Dm7 2beats] [CHORD G7 2beats] [CHORD Cmaj7 4beats]
   각 코드: quality + duration

2. Style Embedding (필수)
   style_id → learned embedding
   예: jazz=0, ballad=1, bossa=2, pop=3 ...

3. Density Token (선택)
   [DENSITY sparse/medium/dense]
   → 마디당 예상 음표 수 범위

4. Register Token (선택)
   [REGISTER low/mid/high]
   → 출력 음역 범위 가이드

5. Tension Level Token (선택)
   [TENSION conservative/moderate/rich]
   → 텐션 사용 빈도 가이드

6. Voicing Preference Token (선택)
   [VOICING shell/rootless/spread/quartal]
   → 보이싱 성향

7. Seed Pattern (선택, Hybrid에서 사용)
   이전 retrieval 결과의 처음 N토큰을 prefix로 제공
   → 모델이 이어서 variation 생성
```

**Conditioning 주입 방식:**
```
방법 1 (권장): Prefix Conditioning
  조건 토큰들을 시퀀스 앞에 붙이고, 모델이 뒤에 이어서 생성
  [STYLE jazz] [DENSITY medium] [TENSION moderate]
  [CHORD Dm7 2b] [CHORD G7 2b] [CHORD Cmaj7 4b]
  [BAR] [NOTE ...] [NOTE ...] ...

방법 2: Cross-attention
  조건 정보를 별도 인코더로 인코딩 → 디코더의 cross-attention으로 주입
  더 복잡하지만 긴 조건에 유리

MVP는 방법 1로 시작.
```

### 추론 흐름 (Inference Flow)

```
사용자 입력
    ↓
┌─────────────────────────────┐
│ 1. 코드 진행 파싱            │
│    "Dm7 | G7 | Cmaj7"       │
│    → 토큰 시퀀스로 변환      │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 2. Conditioning 조립         │
│    style + density + tension │
│    + chord tokens            │
│    → prefix sequence         │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 3. 생성 모델 실행            │
│    Autoregressive decoding   │
│    temperature: 0.8~1.0      │
│    top-k: 50                 │
│    top-p: 0.9                │
│    max_tokens: bar_count * ~64│
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 4. 디코딩                    │
│    상대 토큰 → 상대 패턴 표현 │
│    (role_tag + degree +       │
│     octave + duration + vel)  │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 5. 화성엔진 보정              │
│    코드톤 정합성 검증          │
│    아보이드노트 교정           │
│    베이스 정렬                │
│    텐션 유효성 확인            │
│    → 환각수정v10 규칙 적용     │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 6. 후처리 엔진               │
│    음역 보정                  │
│    중복음 제거                │
│    어색한 도약 스무딩          │
│    벨로시티 커브 적용          │
│    humanize (timing offset)   │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│ 7. MIDI Export               │
│    Type 1, 480 PPQN          │
│    Ableton 호환               │
└─────────────────────────────┘
```

### 화성엔진 보정 단계 상세 (Step 5)

이 단계가 **이 시스템의 핵심 차별점**이다.
생성 모델의 출력을 그대로 내보내지 않고, 화성엔진이 검증/보정한다.

```
보정 체크리스트:

□ 매 chord segment에서 ROOT가 하나 이상 존재하는가
□ THIRD가 존재하는가 (없으면 품질 판별 불가)
□ 아보이드노트가 강박에 위치하지 않는가
  → 위치하면: 가장 가까운 코드톤으로 교체
□ 텐션이 코드-스케일 관계에서 유효한가
  → 아니면: 유효 텐션으로 교체 또는 코드톤으로 단순화
□ 베이스음이 코드 루트 또는 지정된 베이스인가
  → 아니면: 베이스 레지스터 노트를 루트로 교정
□ 멜로디-반주 단9도 충돌이 없는가
□ 연주 가능 음역 이내인가
□ 저음역 뭉침이 없는가
□ 손 크기 초과 보이싱이 없는가

보정 규칙 우선순위:
  1. 하드 제약 위반 → 무조건 교정
  2. 소프트 제약 위반 → 점수 기반 교정 (threshold 이하만)
  3. 교정 시 원본 리듬/방향 최대 보존
```

---

## 2-3. Phase 5: Hybrid (최종 아키텍처)

```
사용자 코드 진행
    ↓
┌──────────────────┐     ┌──────────────────┐
│ Retrieval Engine │────→│ Top-K 패턴 후보    │
│ (DB 검색)        │     │ (k=5~10)          │
└──────────────────┘     └────────┬─────────┘
                                  ↓
                    ┌──────────────────────────┐
                    │ 생성 모델                  │
                    │ retrieval 결과를 seed로    │
                    │ variation 생성             │
                    │ 사용자 조건 conditioning    │
                    └─────────────┬────────────┘
                                  ↓
                    ┌──────────────────────────┐
                    │ 화성엔진 보정              │
                    │ (환각수정v10 규칙 전체)     │
                    └─────────────┬────────────┘
                                  ↓
                    ┌──────────────────────────┐
                    │ 후처리 + MIDI Export       │
                    └──────────────────────────┘
```

Hybrid의 핵심: **retrieval이 '뼈대'를 제공하고, 생성 모델이 '살'을 붙이고, 화성엔진이 '검증'한다.**

---

# 3. Variation 생성 정책

같은 코드 진행에 대해 다양한 결과를 만드는 것이 사용자 가치의 핵심.

## 3-1. Variation 축

| 축 | 설명 | 제어 방법 |
|----|------|----------|
| **리듬 변형** | 같은 코드톤이지만 리듬이 다름 | 다른 rhythm_pattern_hash 패턴 검색 |
| **보이싱 변형** | 같은 리듬이지만 보이싱이 다름 (shell vs spread vs rootless) | voicing_type 파라미터 변경 |
| **밀도 변형** | 음표 수가 다름 (sparse ↔ dense) | density 파라미터 |
| **텐션 변형** | 코드톤 위주 vs 텐션 풍부 | tension_level 파라미터 |
| **음역 변형** | 같은 패턴, 다른 옥타브 | register 파라미터 |
| **스토캐스틱 변형** | 생성 모델의 temperature/seed 변경 | variation_seed |

## 3-2. Variation 생성 전략

```
Phase 3 (Retrieval):
  방법 1: 검색 결과 Top-K에서 k번째를 선택 (k=1,2,3...)
  방법 2: 같은 패턴, voicing_type만 교체하여 재배치
  방법 3: 리듬 유지, 코드톤 순서 변경 (1-3-5-7 → 5-7-1-3)
  방법 4: 원본 패턴에 미세 리듬 변형 적용 (±16분음표 시프트)

Phase 4 (Generation):
  방법: temperature 조절 + 다른 random seed
  temperature 0.7 = 보수적 (원본과 비슷)
  temperature 1.0 = 표준
  temperature 1.2 = 모험적 (때로 이상한 결과)

Phase 5 (Hybrid):
  방법: retrieval 후보를 바꾸면 생성 모델의 seed가 달라짐
  → 같은 조건에서 후보 1번 기반 variation과 후보 3번 기반 variation이 다름
```

---

# 4. 사용자 제어 파라미터

## 4-1. 필수 입력

| 파라미터 | 타입 | 예시 | 설명 |
|---------|------|------|------|
| `chord_progression` | string[] | `["Dm7", "G7", "Cmaj7"]` | 코드 진행 |
| `bar_count` | int | `4` | 생성 길이 (마디 수) |

## 4-2. 선택 입력

| 파라미터 | 타입 | 기본값 | 범위/옵션 | 사용자 언어 예시 |
|---------|------|--------|----------|----------------|
| `style` | enum | `jazz` | jazz, ballad, bossa, pop, classical, r_and_b, funk, latin, film | "재즈 느낌으로" |
| `tempo_bpm` | int | `120` | 40~240 | "빠르게" → 160 |
| `time_signature` | string | `4/4` | 4/4, 3/4, 6/8, 5/4 | "왈츠로" → 3/4 |
| `density` | enum | `medium` | sparse, medium, dense | "음표 적게" → sparse |
| `tension_level` | enum | `moderate` | conservative, moderate, rich | "텐션 많이" → rich |
| `voicing_preference` | enum | `auto` | auto, shell, rootless, spread, quartal, block | "루트리스로" |
| `register` | enum | `mid` | low, mid, high, full | "높은 음역으로" → high |
| `instrument_role` | enum | `piano_comping` | piano_comping, piano_solo, bass_line, pad, arpeggio | "아르페지오로" |
| `variation_seed` | int | `random` | 0~2^32 | (내부 파라미터) |
| `variation_count` | int | `1` | 1~5 | "3가지 버전으로" → 3 |
| `humanize` | float | `0.5` | 0.0(기계적)~1.0(인간적) | "딱딱하지 않게" → 0.7 |
| `swing_amount` | float | `0.0` | 0.0(straight)~1.0(heavy swing) | "스윙으로" → 0.6 |
| `bass_style` | enum | `root_motion` | root_motion, walking, pedal, arpeggiated | "워킹베이스" |

## 4-3. 자연어 → 파라미터 매핑 예시

이후 자연어 인터페이스를 붙일 경우를 위해:

```
"이 진행에서 텐션 많이 쓰기"
  → tension_level: rich

"너무 재즈스럽지 않게"
  → style: pop_jazz, tension_level: conservative

"루트/3도/7도 위주"
  → tension_level: conservative, voicing_preference: shell

"아르페지오보단 패드형 보이싱"
  → instrument_role: pad, voicing_preference: block

"베이스 무빙은 단순하게"
  → bass_style: root_motion

"멜로디성 상성부를 유지하면서 코드톤 중심"
  → register: high, tension_level: conservative, density: medium
```

---

# 5. 평가 기준

## 5-1. 자동 평가 (Automated Metrics)

### A. 화성 정합성 (Harmonic Accuracy)

```
정의: 생성된 노트 중 현재 코드의 코드톤+허용텐션에 해당하는 비율

계산:
  chord_tone_ratio = (코드톤 + 허용텐션 노트 수) / 전체 노트 수

  기준:
    강박 코드톤 비율 ≥ 0.85 (strong-beat chord-tone ratio)
    전체 코드톤 비율 ≥ 0.70 (weak beats에서는 비화성음 허용)

  목표: 95%+ 강박 정합성
```

### B. 베이스 정확도 (Bass Accuracy)

```
정의: 각 코드 segment의 첫 번째 강박 베이스 노트가 지정된 루트/베이스와 일치하는 비율

  기준: ≥ 0.95
```

### C. 아보이드노트 위반율 (Avoid-Note Violation Rate)

```
정의: 아보이드노트가 강박에서 구조적으로 사용된 비율

  기준: ≤ 0.02 (2% 이하)
```

### D. 보이스 리딩 품질 (Voice-Leading Score)

```
정의: 인접 코드 간 최상성부 이동의 평균 반음 수

  좋음: 평균 ≤ 2 semitones
  허용: 평균 ≤ 4 semitones
  나쁨: 평균 > 6 semitones
```

### E. 리듬 다양성 (Rhythm Diversity)

```
정의: 연속 마디의 리듬 패턴 반복도

  계산: 1 - (동일 리듬 마디 쌍 수 / 전체 인접 마디 쌍 수)

  기준: ≥ 0.4 (40% 이상의 마디 쌍이 서로 다른 리듬)
```

### F. 연주 가능성 (Playability Score)

```
정의: 환각수정v10의 playability_constraints 위반 비율

  기준: 위반율 ≤ 0.01 (1% 이하)
```

### G. 코드 진행 충실도 (Progression Fidelity)

```
정의: 생성된 MIDI를 다시 화성분석 엔진에 넣었을 때,
      원래 입력 코드 진행과 일치하는 segment 비율

  계산: 분석엔진(생성MIDI).labels == 입력코드진행 의 비율

  기준: ≥ 0.90

  이것이 전체 시스템의 최종 end-to-end 정확도 지표.
  "입력한 코드대로 들리는가?"를 직접 측정한다.
```

## 5-2. 인간 평가 (Human Evaluation)

자동 평가만으로는 "음악적으로 자연스러운가"를 판단할 수 없다.

### 평가 항목

| 항목 | 점수 범위 | 설명 |
|------|----------|------|
| 자연스러움 | 1~5 | "기계적이지 않고 사람이 연주한 것 같은가" |
| 화성 적합성 | 1~5 | "코드 진행에 맞게 들리는가" |
| 리듬 품질 | 1~5 | "리듬이 음악적인가, 단조롭지 않은가" |
| 보이싱 품질 | 1~5 | "보이싱이 풍부하고 적절한가" |
| 사용 가능성 | 1~5 | "DAW에서 바로 쓸 수 있는 수준인가" |

### 평가 방법

```
1. A/B 테스트: 생성 MIDI vs 사람 연주 MIDI (블라인드)
2. 장르별 평가: 장르 전문가가 해당 장르 기준으로 평가
3. 프로 작곡가 피드백: "실제 작업에서 이 결과물을 쓸 의향이 있는가"
```

## 5-3. 평가 데이터셋

```
Gold Standard Test Set:
  - 최소 50개 MIDI excerpt
  - 장르별 분포: jazz 20, pop 10, ballad 10, bossa 5, classical 5
  - 각각 수동 코드 라벨링 완료
  - 각각 전문가 품질 점수 부여
  - 모든 규칙 변경 시 이 셋에 대해 regression test 실행
```

---

# 6. MVP 범위 (명확한 경계)

## 6-1. MVP에 포함

| 항목 | 스펙 |
|------|------|
| 악기 | 피아노 (단일 악기) |
| 길이 | 4~8마디 |
| 박자 | 4/4 |
| 코드 입력 | 텍스트 기반 코드 심볼 (예: "Dm7", "Cmaj7") |
| 생성 방식 | Retrieval + Rearrangement (Phase 3) |
| DB 크기 | 최소 100개 패턴 (25개 코드 품질 × 4개 리듬 변형) |
| 스타일 | 1개 장르로 시작 (jazz 권장) |
| 출력 | MIDI 파일 (Type 1, 480 PPQN) |
| 화성엔진 | 분석 + 재배치 모두 동작 |
| 노트 태깅 | 기본 역할 태깅 (ROOT/THIRD/FIFTH/SEVENTH/PASSING/NEIGHBOR) |
| 후처리 | 음역 보정, 중복음 제거, 연주가능성 검증 |
| 사용자 제어 | chord_progression, bar_count, density, tension_level |

## 6-2. MVP에서 제외 (Phase 4~5로 이관)

| 항목 | 이유 |
|------|------|
| Sequence Generation Model | 충분한 데이터와 화성엔진 안정성 확보 후 |
| Hybrid 아키텍처 | Phase 3 + Phase 4 합류 이후 |
| 멀티트랙 | 피아노 단독으로 먼저 검증 |
| 드럼/베이스/스트링 동시 생성 | 패턴 DB와 재배치 로직이 악기별로 다름 |
| 자연어 입력 | 파라미터 매핑 레이어는 별도 |
| 실시간 생성 | 오프라인 생성 먼저 |
| DAW 플러그인 | 커맨드라인 또는 API 먼저 |
| 긴 곡 구조 (32마디+) | 8마디 이하 먼저 안정화 |
| 복잡한 폴리리듬 | 4/4 단순 리듬 먼저 |
| 오디오 렌더링 | MIDI 출력까지만 |

## 6-3. MVP 완료 기준 (Definition of Done)

```
□ 사용자가 코드 진행 4마디를 입력하면 MIDI가 생성된다
□ 생성 결과의 강박 코드톤 비율 ≥ 85%
□ 생성 결과의 베이스 정확도 ≥ 95%
□ 아보이드노트 위반율 ≤ 2%
□ 연주가능성 위반율 ≤ 1%
□ 같은 입력에 최소 3가지 variation 생성 가능
□ 전문가 평가 평균 ≥ 3.5/5.0
□ Ableton에서 import하여 정상 재생 가능
□ 코드 진행 충실도 (round-trip) ≥ 90%
```

---

# 7. 기술 스택 권장

## 7-1. MVP 기술 스택

```
언어: Python 3.10+
MIDI 파싱: mido (또는 pretty_midi)
DB: SQLite (MVP) → PostgreSQL (production)
패턴 검색: 단순 SQL 쿼리 + Python 유사도 계산
화성엔진: 순수 Python 규칙 엔진 (환각수정v10 기반)
후처리: Python
MIDI 출력: mido
테스트: pytest + gold standard test set
```

## 7-2. Phase 4 추가 기술 스택

```
모델 프레임워크: PyTorch
토크나이저: 커스텀 (음악 토큰)
학습 데이터: Parquet → PyTorch DataLoader
모델 서빙: FastAPI + 로컬 GPU 또는 클라우드
벡터 검색 (Hybrid): FAISS
```

## 7-3. 장기 기술 스택

```
DAW 연동: Ableton Live API (Max for Live device) 또는 VST3 플러그인
프론트엔드: Electron 또는 Web (React)
클라우드: AWS/GCP (GPU 인스턴스)
모니터링: 생성 결과 품질 대시보드
```

---

# 8. 개발 일정 권장

## 8-1. Phase 1: 화성엔진 (4~6주)

```
Week 1-2: MIDI 파싱 + 기본 화성 분석
  - MIDI 파일 읽기
  - 박자/템포 추출
  - 분석 윈도우 분할
  - 기본 코드 후보 생성

Week 3-4: 화성 분석 고도화
  - 키 추정
  - 베이스 패턴 분류
  - 페달톤 감지
  - 노트 역할 태깅

Week 5-6: 검증 + 재배치 엔진
  - Gold test set 구축 (최소 20개)
  - 분석 정확도 측정
  - 재배치 알고리즘 구현
  - 라운드트립 테스트
```

## 8-2. Phase 2: 패턴 DB 구축 (3~4주)

```
Week 7-8: 데이터 수집 + 분석
  - MIDI 소스 확보 (라이선스 확인)
  - 화성엔진으로 자동 라벨링
  - 품질 검수 (수동 spot-check)

Week 9-10: 패턴 추출 + DB 저장
  - 마디/프레이즈 단위 패턴 분리
  - 상대 패턴 표현 변환
  - DB 스키마 구현
  - 리듬/윤곽 해시 인덱싱
```

## 8-3. Phase 3: Retrieval MVP (3~4주)

```
Week 11-12: 검색 엔진
  - 검색 로직 구현
  - 랭킹 알고리즘
  - API 또는 CLI 인터페이스

Week 13-14: 통합 + 평가
  - 전체 파이프라인 연결
  - 자동 평가 메트릭 구현
  - 인간 평가 세션
  - 버그 수정 + 조정
```

## 8-4. Phase 4: 생성 모델 (6~8주)

```
Week 15-18: 모델 학습
  - 토크나이저 구현
  - 학습 데이터 준비
  - 모델 아키텍처 구현
  - 학습 + 하이퍼파라미터 튜닝

Week 19-22: 통합 + 고도화
  - 화성엔진 보정 연결
  - Hybrid 아키텍처 시도
  - 평가 + 반복
```

총 MVP (Phase 1~3): **약 10~14주**
전체 (Phase 1~4): **약 20~22주**

---

# 9. 리스크와 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 화성엔진 정확도 부족 | 전체 시스템 신뢰도 하락 | Gold test set 기반 반복 개선. 규칙 DB를 잘게 쪼개서 개별 테스트. |
| 패턴 DB 부족 | 검색 결과 다양성 부족 | 초기에는 수동 패턴 입력도 허용. 50개로 시작 → 점진 확장. |
| 재배치 시 부자연스러움 | 음악적 품질 하락 | 후처리 엔진에서 보이스 리딩/레지스터 스무딩 강화. |
| 절대음 학습의 전조 취약성 | 같은 패턴인데 키 다르면 실패 | 상대 표현 기반 학습으로 원천 방지. |
| 생성 모델 화성 위반 | 코드 정합성 깨짐 | 화성엔진 후보정이 안전망. 모델이 100% 맞을 필요 없음. |
| MIDI 저작권 | 법적 리스크 | 라이선스 확인된 데이터만 사용. 필요시 자체 연주 MIDI 제작. |
| CC64 미처리 | 피아노 MIDI 분석 정확도 급락 | Phase 1에서 반드시 구현. 생략 불가. |

---

# 10. 이 문서의 위치 (다시 정리)

```
┌─────────────────────────────────────────────┐
│               전체 제품 PRD                   │
│                                               │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ message.txt │  │ 이 문서               │   │
│  │ 제품 비전    │  │ 생성모델 설계         │   │
│  │ 아키텍처 개요│  │ 학습/추론/평가        │   │
│  │ 사용자 시나리오│ │ MVP 범위/일정        │   │
│  │ Phase 계획   │  │ 사용자 제어 파라미터  │   │
│  └──────┬──────┘  └──────────┬───────────┘   │
│         │                     │               │
│         └──────────┬──────────┘               │
│                    ↓                          │
│         ┌──────────────────────┐              │
│         │ 환각수정v10.json      │              │
│         │ 화성분석 규칙 DB      │              │
│         │ 노트 역할 태깅 스펙   │              │
│         │ 패턴 표현 포맷        │              │
│         │ DB 스키마             │              │
│         │ Ableton 연동 스펙     │              │
│         │ 코드/보이싱 규칙      │              │
│         └──────────────────────┘              │
│                                               │
└─────────────────────────────────────────────┘
```

이 세 문서를 함께 전달하면,
개발자가 **무엇을 만들지(message.txt)**, **어떻게 만들지(이 문서)**, **어떤 규칙으로(환각수정v10)** 를 모두 파악할 수 있다.
