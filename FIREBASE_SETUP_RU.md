# Подключение Firebase — последовательность действий

Все действия разработчика. Владелец салона после передачи не должен менять код.

**Стоимость:** для Cloud Functions и Cloud Storage нового проекта Firebase потребуется тариф Blaze и платёжный аккаунт. Доступны бесплатные квоты, но возможны расходы. В настройках Google Cloud создайте бюджет и предупреждения о расходах. До подключения оплаты используйте только локальное DEMO.

### Шаг 1. Создать проект Firebase

Откройте [Firebase Console](https://console.firebase.google.com/), нажмите **Add project / Создать проект**, задайте название (например `el-bem-beauty`) и завершите создание. Не удаляйте старый Supabase-проект.

### Шаг 2. Добавить веб-приложение

В обзоре Firebase нажмите значок Web `</>`, задайте имя `EL BEM Web`, зарегистрируйте приложение. Откройте **Project settings → Your apps → SDK setup and configuration → Config**. Сохраните публичные поля `apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`.

### Шаг 3. Включить логин

Firebase Console → **Authentication → Get started → Sign-in method → Email/Password → Enable → Save**. Для личного кабинета используются обычные клиентские аккаунты. Google/GitHub OAuth не обязателен по базовым экзаменационным критериям.

### Шаг 4. Создать Firestore

Firebase Console → **Firestore Database → Create database**. Выберите подходящий регион, запустите в production/restricted mode (не в открытом test mode). Затем опубликуйте правила из `firestore.rules` через Firebase CLI.

### Шаг 5. Настроить Cloud Storage

Firebase Console → **Storage → Get started**. Для нового проекта потребуется Blaze. Создайте бакет, а затем опубликуйте `storage.rules`. Не давайте всем посетителям возможность загружать файлы.

### Шаг 6. Заполнить локальный `.env`

Скопируйте `.env.example` в новый `.env` в корне сайта. Заполните пять публичных настроек из Шага 2. `VITE_FIREBASE_FUNCTIONS_REGION=europe-west1` должен совпадать с регионом Functions. Никаких secret/service-account ключей здесь быть не должно.

### Шаг 7. Установить зависимости

В терминале корня сайта:

```bash
npm install
npm run check:i18n
npm run typecheck
npm run build
```

Затем серверный каталог:

```bash
cd functions
npm install
npm run check
cd ..
```

### Шаг 8. Развернуть правила и Functions

Установите официальный Firebase CLI (нужен интернет):

```bash
npm install -g firebase-tools
firebase login
firebase deploy --project YOUR_FIREBASE_PROJECT_ID --only firestore:rules,storage,functions
```

Замените `YOUR_FIREBASE_PROJECT_ID` на project ID, не на название проекта. При ошибках прав/оплаты остановитесь и проверьте конкретное сообщение CLI. Не ослабляйте Security Rules для «быстрого решения» ошибок.

### Шаг 9. Заполнить тестовый каталог (необязательно)

В `functions/seed-data.json` есть оригинальные демонстрационные услуги, мастера, товары и содержимое сайта. Скрипт добавляет только отсутствующие документы и не перезаписывает существующие:

```bash
GOOGLE_CLOUD_PROJECT=YOUR_FIREBASE_PROJECT_ID node functions/scripts/seed-demo.cjs
```

Для исполнения нужны Google Application Default Credentials с правами нужного проекта — например, после `gcloud auth application-default login` для авторизованного разработчика или через **закрытый локальный путь** к service-account файлу. Не помещайте такой файл в ZIP или репозиторий. Начальные товары и цены имеют статус DEMO.

### Шаг 10. Безопасно назначить владельца администратором

Firebase Console → Authentication → Users → Add user. Создайте отдельный аккаунт владельца с его подтверждённым email и временным уникальным паролем. Затем в закрытом терминале разработчика, используя Admin SDK с правами назначения ролей:

```bash
GOOGLE_CLOUD_PROJECT=YOUR_FIREBASE_PROJECT_ID node functions/scripts/grant-admin.cjs OWNER_EMAIL
```

Замените `OWNER_EMAIL` на фактический email созданной записи. После выдачи роли выйдите и войдите снова, чтобы обновить токен. **Не существует публичного способа зарегистрировать себя администратором**. После входа владелец может поменять пароль в админ-панели.

### Шаг 11. Локально проверить реальные функции

С заполненным `.env` выполните `npm run dev`. Проверьте регистрацию и повторный вход, личный кабинет, создание реальной заявки, отображение на другом устройстве, подтверждение и отмену, одновременную запись на один интервал, товары, заказы, загрузку фото, сохранение настроек и доступ обычного клиента к чужим данным. Проверьте Security Rules в Firebase Emulator Suite.

### Шаг 12. Развернуть frontend на Vercel

1. Создайте приватный репозиторий GitHub; запушьте только исходники и пример `.env.example`.
2. На Vercel создайте проект из этого GitHub репозитория; Framework preset — **Vite**.
3. В настройках проекта Vercel → Environment Variables добавьте публичные `VITE_FIREBASE_*` и, при необходимости, `VITE_SALON_WHATSAPP`.
4. Build command: `npm run build`; Output directory: `dist`.
5. Выполните Deploy и проверьте прямые ссылки `/services`, `/booking`, `/account`, `/admin`.
6. В Firebase Authentication → Settings → Authorized domains добавьте опубликованный домен, если он отсутствует.

### Шаг 13. Безопасность перед настоящим запуском

Для серверной защиты от автоматизированных запросов зарегистрируйте Firebase App Check с reCAPTCHA v3, добавьте публичный ключ в `VITE_FIREBASE_APPCHECK_SITE_KEY`, а в окружении Cloud Functions задайте `ENFORCE_APPCHECK=true` и повторно разверните функции. Важно: включать серверное требование **после** настройки клиента, иначе заявки перестанут приниматься. App Check не заменяет rate limiting, аудит прав, защиту персональных данных и проверку реальных нагрузок. Поставьте ограничения расходов/квот и проверьте политику обработки персональных данных.

### Первый практический шаг

Сначала создайте Firebase-проект (Шаг 1). После него можно последовательно выполнить оставшиеся шаги, сверяя каждый результат.
