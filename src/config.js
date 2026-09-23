// Всё, что здесь, можно смело править: тексты, открытку, цвета.

export const APP_TITLE = 'Твой торт'

// Имя пусть останется пустым, если не нужно: тогда просто «С днём рождения!».
export const NAME = ''

export const AGE = 29

export const TEXT = {
  startEyebrow: 'С днём рождения',
  startTitle: 'Твой торт',
  startLead: 'Собери торт, какой хочешь. Потом свечи и желание.',
  startButton: 'Начать',
  steps: ['Форма', 'Цвет', 'Декор'],
  next: 'Дальше',
  back: 'Назад',
  done: 'Зажечь свечи',
  decorHint: 'Выбери украшение и нажимай на торт. Крутить — пальцем.',
  shapeHint: 'Смена формы очистит декор',
  wish: 'Загадай желание…',
  blowHint: 'Теперь задуй свечи: проведи пальцем по огонькам',
  micButton: 'или подуй по-настоящему',
  micListening: 'Дуй в микрофон',
  finaleTitle: 'С днём рождения!',
  finaleLead: 'люблю тебя 🫶',
  saveButton: 'Сохранить торт',
  againButton: 'Сделать другой',
  saveHint: 'Нажми и удерживай картинку, чтобы сохранить',
}

// Письмо в следующий год: она пишет цели и желания, письмо сгорает над свечами,
// а желания остаются на сохранённой картинке с тортом.
export const WISH = {
  title: 'Письмо в следующий год',
  lead: 'Запиши свои главные цели и желания на год. Письмо сгорит в огне свечей, и всё обязательно сбудется.',
  placeholders: ['Первое', 'Второе', 'Третье', 'Ещё одно', 'И ещё'],
  send: 'Отправить в следующий год',
  skip: 'Без письма',
  paperLabel: 'Письмо в следующий год',
  burnHint: 'Нажми, чтобы отправить письмо',
  sent: 'Отправлено. Теперь это обязательно сбудется',
  posterTitle: 'Мои желания на год',
}

export const SHAPES = [
  { id: 'round', label: 'Круг' },
  { id: 'square', label: 'Квадрат' },
  { id: 'heart', label: 'Сердце' },
]

export const SPONGES = [
  { id: 'vanilla', label: 'Ваниль', color: '#f1d9a6' },
  { id: 'chocolate', label: 'Шоколад', color: '#6e4838' },
  { id: 'strawberry', label: 'Клубника', color: '#f2abb8' },
  { id: 'pistachio', label: 'Фисташка', color: '#c6d8a0' },
  { id: 'velvet', label: 'Красный бархат', color: '#b4444f' },
  { id: 'lavender', label: 'Лаванда', color: '#cbbde6' },
]

export const CREAMS = [
  { id: 'white', label: 'Белый', color: '#fff7ef' },
  { id: 'pink', label: 'Розовый', color: '#f8ccd6' },
  { id: 'peach', label: 'Персик', color: '#f9d4b6' },
  { id: 'mint', label: 'Мята', color: '#cfe7d6' },
  { id: 'sky', label: 'Голубой', color: '#cfdff2' },
  { id: 'lilac', label: 'Лаванда', color: '#ddd0f2' },
  { id: 'cocoa', label: 'Какао', color: '#8d5c46' },
]

export const GLAZES = [
  { id: 'none', label: 'Без глазури', color: null },
  { id: 'chocolate', label: 'Шоколад', color: '#4b2b21' },
  { id: 'caramel', label: 'Карамель', color: '#c98b40' },
  { id: 'white', label: 'Белый шоколад', color: '#fff3e4' },
  { id: 'pink', label: 'Розовая', color: '#ee9db3' },
  { id: 'berry', label: 'Ягодная', color: '#9d2f56' },
]

export const BORDERS = [
  { id: 'none', label: 'Без бордюра' },
  { id: 'top', label: 'Сверху' },
  { id: 'both', label: 'Сверху и снизу' },
]

export const DEFAULT_DESIGN = {
  shape: 'round',
  sponge: 'vanilla',
  cream: 'pink',
  glaze: 'none',
  border: 'top',
}
