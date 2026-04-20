        // 全域變數
        let mqtt_client = null;
        let currentDeviceId = '';
        let currentUsername = '';
        let isLoggedIn = false;
        let loginTimeout = null;
        let pendingAction = null;

        // 設定操作互斥鎖與超時
        let settingsLock = false;
        let settingsTimeout = null;
        const SETTINGS_TIMEOUT_MS = 10000; // 10秒超時

        // MQTT 設定
        const WORKER_URL = 'https://twilight-river-1c4f.fire2002.workers.dev';
        const MQTT_BROKER = 'wss://mqttgo.vip:8084/mqtt';
        const TOPIC_PREFIX = '/user/fire2002_dev';

        // Topic 定義
        const getTopics = (deviceId) => ({
            LOGIN_REQUEST: `${TOPIC_PREFIX}/${deviceId}/login/request`,
            LOGOUT_REQUEST: `${TOPIC_PREFIX}/${deviceId}/logout/request`,
            LOGIN_RESPONSE: `${TOPIC_PREFIX}/${deviceId}/login/response`,
            COMMAND: `${TOPIC_PREFIX}/${deviceId}/command`,
            STATUS: `${TOPIC_PREFIX}/${deviceId}/status`,
            FEEDBACK: `${TOPIC_PREFIX}/${deviceId}/feedback`,
            IMAGE: `${TOPIC_PREFIX}/${deviceId}/image`,
            SETTINGS: `${TOPIC_PREFIX}/${deviceId}/settings`,
            SETTINGS_REQUEST: `${TOPIC_PREFIX}/${deviceId}/settings/request`,
            SETTINGS_RESPONSE: `${TOPIC_PREFIX}/${deviceId}/settings/response`
        });

        // 等待登入的暫存資料
        let pendingLogin = null;

        // 初始化 MQTT 連線（credentials 由 Worker 提供）
        function initMQTT(credentials) {
            const clientId = "plant_" + Math.random().toString(16).substr(2, 8);
            const brokerUrl = (credentials && credentials.broker) ? credentials.broker : MQTT_BROKER;
            const options = {
                username: credentials ? credentials.username : '',
                password: credentials ? credentials.password : '',
                keepalive: 60,
                clientId: clientId,
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 0,
                connectTimeout: 30 * 1000
            };

            updateMQTTStatus('connecting');

            mqtt_client = mqtt.connect(brokerUrl, options);

            mqtt_client.on('connect', () => {
                console.log('MQTT Connected');
                updateMQTTStatus('connected');
                if (pendingLogin) {
                    const pl = pendingLogin;
                    pendingLogin = null;
                    doLoginFlow(pl.deviceId, pl.username, pl.password);
                }
            });

            mqtt_client.on('error', (err) => {
                console.error('MQTT Error:', err);
                updateMQTTStatus('disconnected');
            });

            mqtt_client.on('close', () => {
                console.log('MQTT Disconnected');
                updateMQTTStatus('disconnected');
            });

            mqtt_client.on('reconnect', () => {
                updateMQTTStatus('connecting');
            });

            mqtt_client.on('message', handleMQTTMessage);
        }

        // 處理 MQTT 訊息
        function handleMQTTMessage(topic, payload) {
            const message = payload.toString();
            console.log('Received:', topic, message);

            const topics = getTopics(currentDeviceId);

            if (topic === topics.LOGIN_RESPONSE) {
                handleLoginResponse(message);
            }
            else if (topic === topics.STATUS) {
                handleStatusUpdate(message);
            }
            else if (topic === topics.FEEDBACK) {
                handleCommandFeedback(message);
            }
            else if (topic === topics.IMAGE) {
                handleImageData(message);
            }
            else if (topic === topics.SETTINGS_RESPONSE) {
                handleSettingsResponse(message);
            }
        }

        // 處理登入回應
        function handleLoginResponse(message) {
            clearTimeout(loginTimeout);
            const loginBtn = document.getElementById('loginBtn');
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
            loginBtn.textContent = '登入系統';

            try {
                const response = JSON.parse(message);

                if (response.success === true || response.status === 'ok' || message === 'OK') {
                    isLoggedIn = true;
                    showControlPage();
                    showLoginStatus('登入成功！', 'success');
                    showToast('登入成功', 'success');

                    const topics = getTopics(currentDeviceId);
                    mqtt_client.subscribe(topics.STATUS);
                    mqtt_client.subscribe(topics.FEEDBACK);
                    mqtt_client.subscribe(topics.IMAGE);
                    mqtt_client.subscribe(topics.SETTINGS_RESPONSE);
                } else {
                    showLoginStatus(response.message || '登入失敗，請檢查帳號密碼', 'error');
                }
            } catch (e) {
                if (message === 'OK' || message === 'SUCCESS' || message === '1') {
                    isLoggedIn = true;
                    showControlPage();
                    showLoginStatus('登入成功！', 'success');
                    showToast('登入成功', 'success');

                    const topics = getTopics(currentDeviceId);
                    mqtt_client.subscribe(topics.STATUS);
                    mqtt_client.subscribe(topics.FEEDBACK);
                    mqtt_client.subscribe(topics.IMAGE);
                    mqtt_client.subscribe(topics.SETTINGS_RESPONSE);
                } else {
                    showLoginStatus('登入失敗: ' + message, 'error');
                }
            }
        }

        // 處理狀態更新
        function handleStatusUpdate(message) {
            try {
                const status = JSON.parse(message);

                // 更新感測器數據
                if (status.core_temp !== undefined) {
                    document.getElementById('coreTemp').textContent = status.core_temp + '°C';
                }
                if (status.env_temp !== undefined) {
                    document.getElementById('envTemp').textContent = status.env_temp + '°C';
                }
                if (status.humidity !== undefined) {
                    document.getElementById('envHumidity').textContent = status.humidity + '%';
                }
                if (status.light !== undefined) {
                    document.getElementById('lightIntensity').textContent = status.light + ' lux';
                }

                // 更新設備狀態（儀表板和設備控制面板）
                updateDeviceStatus('lightStatusDot', status.light_on);
                updateDeviceStatus('controlLightStatusDot', status.light_on);
                updateDeviceStatus('fanStatusDot', status.fan_on);
                updateDeviceStatus('controlFanStatusDot', status.fan_on);
                updateDeviceStatus('smallFanStatusDot', status.small_fan_on);
                updateDeviceStatus('controlSmallFanStatusDot', status.small_fan_on);
                updateDeviceStatus('pumpStatusDot', status.pump_on);
                updateDeviceStatus('controlPumpStatusDot', status.pump_on);
                updateDeviceStatus('humidifierStatusDot', status.humidifier_on);
                updateDeviceStatus('controlHumidifierStatusDot', status.humidifier_on);
                updateDeviceStatus('controlScheduleStatusDot', status.schedule_on);

            } catch (e) {
                console.error('Status parse error:', e);
            }
        }

        // 更新設備狀態指示
        function updateDeviceStatus(elementId, isOn) {
            const dot = document.getElementById(elementId);
            if (dot) {
                if (isOn) {
                    dot.classList.add('on');
                } else {
                    dot.classList.remove('on');
                }
            }
        }

        // 處理指令回饋
        function handleCommandFeedback(message) {
            try {
                const feedback = JSON.parse(message);
                const msgType = feedback.success ? 'success' : 'error';
                showToast(feedback.message || '指令已執行', msgType);
            } catch (e) {
                showToast('指令回饋: ' + message, 'success');
            }
        }

        // 處理影像數據
        function handleImageData(message) {
            try {
                const data = JSON.parse(message);
                if (data.image) {
                    const img = document.getElementById('capturedImage');
                    const placeholder = document.getElementById('imagePlaceholder');

                    img.src = 'data:image/jpeg;base64,' + data.image;
                    img.style.display = 'block';
                    placeholder.style.display = 'none';

                    updateImageStatus('影像讀取成功', 'success');
                }
            } catch (e) {
                // 可能是直接的 base64 數據
                const img = document.getElementById('capturedImage');
                const placeholder = document.getElementById('imagePlaceholder');

                img.src = 'data:image/jpeg;base64,' + message;
                img.style.display = 'block';
                placeholder.style.display = 'none';

                updateImageStatus('影像讀取成功', 'success');
            }
        }

        // 更新 MQTT 狀態顯示
        function updateMQTTStatus(status) {
            const dot = document.getElementById('mqttStatusDot');
            const text = document.getElementById('mqttStatusText');

            dot.className = 'status-dot';

            switch(status) {
                case 'connected':
                    dot.classList.add('connected');
                    text.textContent = 'MQTT 已連線';
                    break;
                case 'connecting':
                    dot.classList.add('connecting');
                    text.textContent = 'MQTT 連線中...';
                    break;
                default:
                    text.textContent = 'MQTT 未連線';
            }
        }

        // 登入處理（先向 Worker 取得 MQTT 帳密，再連線登入）
        async function handleLogin() {
            const accessKey = document.getElementById('accessKey').value.trim();
            const deviceId = document.getElementById('deviceId').value.trim();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();

            if (!accessKey || !deviceId || !username || !password) {
                showLoginStatus('請填寫所有欄位', 'error');
                return;
            }

            if (loginTimeout) {
                clearTimeout(loginTimeout);
                loginTimeout = null;
            }

            const loginBtn = document.getElementById('loginBtn');
            loginBtn.classList.add('loading');
            loginBtn.disabled = true;
            loginBtn.textContent = '';
            hideLoginStatus();

            showLoginStatus('向 Worker 取得 MQTT 帳密…', 'warning');

            // Step 1: 向 Worker 取得 MQTT 帳密
            let creds;
            try {
                const resp = await fetch(`${WORKER_URL}/token?key=${encodeURIComponent(accessKey)}`);
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.error || 'Unauthorized');
                }
                creds = await resp.json();
            } catch (e) {
                showLoginStatus('通關密語驗證失敗：' + e.message, 'error');
                loginBtn.classList.remove('loading');
                loginBtn.disabled = false;
                loginBtn.textContent = '登入系統';
                return;
            }

            showLoginStatus('MQTT 連線中…', 'warning');

            // Step 2: 中斷舊連線並以新帳密重新連線
            if (mqtt_client) {
                mqtt_client.end(true);
                mqtt_client = null;
            }

            currentDeviceId = deviceId;
            currentUsername = username;
            pendingLogin = { deviceId, username, password };

            initMQTT(creds);
        }

        // 實際執行 MQTT 登入流程（MQTT 連線後呼叫）
        function doLoginFlow(deviceId, username, password) {
            const loginBtn = document.getElementById('loginBtn');

            const topics = getTopics(deviceId);
            mqtt_client.subscribe(topics.LOGIN_RESPONSE, (err) => {
                if (err) {
                    showLoginStatus('訂閱失敗: ' + err.message, 'error');
                    loginBtn.classList.remove('loading');
                    loginBtn.disabled = false;
                    loginBtn.textContent = '登入系統';
                    return;
                }

                const loginData = JSON.stringify({ username, password });
                mqtt_client.publish(topics.LOGIN_REQUEST, loginData);
                showLoginStatus('正在驗證登入...', 'warning');

                loginTimeout = setTimeout(() => {
                    loginBtn.classList.remove('loading');
                    loginBtn.disabled = false;
                    loginBtn.textContent = '登入系統';
                    showLoginStatus('登入超時，請確認裝置是否在線', 'error');
                    mqtt_client.unsubscribe(topics.LOGIN_RESPONSE);
                }, 10000);
            });
        }

        // 臨時跳過登入函數 - 可移除
        function bypassLogin() {
            isLoggedIn = true;
            currentDeviceId = 'TEST_DEVICE';
            currentUsername = 'test_user';
            showControlPage();
            showToast('測試模式 - 已跳過登入', 'warning');

            // 填入測試數據
            document.getElementById('coreTemp').textContent = '42.5°C';
            document.getElementById('envTemp').textContent = '26.3°C';
            document.getElementById('envHumidity').textContent = '65%';
            document.getElementById('lightIntensity').textContent = '1250 lux';

            // 隨機設置一些設備狀態
            updateDeviceStatus('lightStatusDot', true);
            updateDeviceStatus('controlLightStatusDot', true);
            updateDeviceStatus('fanStatusDot', false);
            updateDeviceStatus('controlFanStatusDot', false);
            updateDeviceStatus('smallFanStatusDot', true);
            updateDeviceStatus('controlSmallFanStatusDot', true);
            updateDeviceStatus('pumpStatusDot', false);
            updateDeviceStatus('controlPumpStatusDot', false);
            updateDeviceStatus('humidifierStatusDot', false);
            updateDeviceStatus('controlHumidifierStatusDot', false);
            updateDeviceStatus('controlScheduleStatusDot', true);
        }
        // 臨時跳過登入函數結束

        // 登出處理
        function handleLogout() {
            if (loginTimeout) {
                clearTimeout(loginTimeout);
                loginTimeout = null;
            }

            if (mqtt_client && mqtt_client.connected && currentDeviceId) {
                const topics = getTopics(currentDeviceId);

                mqtt_client.publish(topics.LOGOUT_REQUEST, JSON.stringify({
                    command: 'logout',
                    username: currentUsername
                }));

                mqtt_client.unsubscribe(topics.LOGIN_RESPONSE);
                mqtt_client.unsubscribe(topics.STATUS);
                mqtt_client.unsubscribe(topics.FEEDBACK);
                mqtt_client.unsubscribe(topics.IMAGE);
                mqtt_client.unsubscribe(topics.SETTINGS_RESPONSE);
                mqtt_client.end(true);
                mqtt_client = null;
            } else if (mqtt_client) {
                mqtt_client.end(true);
                mqtt_client = null;
            }

            // 清除設定操作相關狀態
            if (settingsTimeout) {
                clearTimeout(settingsTimeout);
                settingsTimeout = null;
            }
            settingsLock = false;

            isLoggedIn = false;
            currentDeviceId = '';
            currentUsername = '';

            showLoginPage();

            document.getElementById('accessKey').value = '';
            document.getElementById('deviceId').value = '';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';

            showToast('已登出系統', 'success');
        }

        // 發送控制指令
        function sendCommand(command) {
            if (!mqtt_client || !mqtt_client.connected) {
                showToast('MQTT 未連線', 'error');
                return;
            }

            if (!currentDeviceId) {
                showToast('裝置未連接', 'error');
                return;
            }

            const topics = getTopics(currentDeviceId);
            mqtt_client.publish(topics.COMMAND, JSON.stringify({ command: command }));
            showToast('指令已發送: ' + command, 'success');
        }

        // 確認操作
        function confirmAction(command, actionName) {
            pendingAction = command;
            document.getElementById('confirmTitle').textContent = '確認' + actionName;
            document.getElementById('confirmMessage').textContent = '您確定要' + actionName + '嗎？此操作可能會影響植物生長環境。';
            document.getElementById('confirmOverlay').classList.add('show');
        }

        function closeConfirm() {
            document.getElementById('confirmOverlay').classList.remove('show');
            pendingAction = null;
        }

        function executeConfirmedAction() {
            if (pendingAction) {
                sendCommand(pendingAction);
                closeConfirm();
            }
        }

        // 讀取影像
        function captureImage() {
            if (!mqtt_client || !mqtt_client.connected) {
                showToast('MQTT 未連線', 'error');
                return;
            }

            updateImageStatus('正在讀取影像...', 'loading');
            sendCommand('capture_image');
        }

        // 清除影像
        function clearImage() {
            const img = document.getElementById('capturedImage');
            const placeholder = document.getElementById('imagePlaceholder');

            img.src = '';
            img.style.display = 'none';
            placeholder.style.display = 'flex';

            updateImageStatus('等待讀取...', '');
        }

        // 更新影像狀態
        function updateImageStatus(text, type) {
            const status = document.getElementById('imageStatus');
            status.textContent = text;
            status.className = 'image-status ' + type;
        }

        // 切換設定項目
        function toggleSetting(name) {
            const checkbox = document.getElementById(name + 'Enabled');
            const content = document.getElementById(name + 'Content');

            if (checkbox.checked) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        }

        // 儲存設定
        function saveSettings() {
            // 檢查互斥鎖
            if (settingsLock) {
                showToast('請等待目前操作完成', 'warning');
                return;
            }

            // 驗證補光燈開啟時間不能大於關閉時間
            const lightOnTime = document.getElementById('lightOnTime').value;
            const lightOffTime = document.getElementById('lightOffTime').value;

            if (document.getElementById('lightEnabled').checked && lightOnTime >= lightOffTime) {
                showToast('補光燈：開啟時間不能晚於或等於關閉時間', 'error');
                return;
            }

            // 驗證通風扇時段
            const fanSchedules = [];
            for (let i = 1; i <= 5; i++) {
                const enabled = document.getElementById(`fanSchedule${i}Enabled`).checked;
                const start = document.getElementById(`fanTime${i}`).value;
                const end = document.getElementById(`fanTime${i}End`).value;

                if (enabled) {
                    if (start >= end) {
                        showToast(`通風扇時段 ${i}：開始時間不能晚於或等於結束時間`, 'error');
                        return;
                    }
                    fanSchedules.push({ enabled: true, start, end });
                } else {
                    fanSchedules.push({ enabled: false, start, end });
                }
            }

            const settings = {
                action: 'save',
                watering: {
                    enabled: document.getElementById('wateringEnabled').checked,
                    interval_days: parseInt(document.getElementById('wateringDays').value),
                    time: document.getElementById('wateringTime').value,
                    duration: parseInt(document.getElementById('wateringDuration').value)
                },
                humidifier: {
                    enabled: document.getElementById('humidifierEnabled').checked,
                    interval_days: parseInt(document.getElementById('humidifierDays').value),
                    time: document.getElementById('humidifierTime').value,
                    duration: parseInt(document.getElementById('humidifierDuration').value)
                },
                light: {
                    enabled: document.getElementById('lightEnabled').checked,
                    on_time: lightOnTime,
                    off_time: lightOffTime
                },
                fan: {
                    enabled: document.getElementById('fanEnabled').checked,
                    schedules: fanSchedules
                },
                schedule: {
                    enabled: document.getElementById('scheduleSettingEnabled').checked,
                    watering_duration: parseInt(document.getElementById('scheduleWateringDuration').value),
                    ventilation_duration: parseInt(document.getElementById('scheduleVentilationDuration').value)
                }
            };

            if (!mqtt_client || !mqtt_client.connected) {
                showToast('MQTT 未連線', 'error');
                return;
            }

            // 設置互斥鎖
            settingsLock = true;
            const saveBtn = document.getElementById('saveSettingsBtn');
            const reloadBtn = document.getElementById('reloadSettingsBtn');
            saveBtn.classList.add('loading');
            saveBtn.disabled = true;
            reloadBtn.disabled = true;
            showSettingsStatus('正在儲存設定...', 'loading');

            const topics = getTopics(currentDeviceId);
            mqtt_client.publish(topics.SETTINGS, JSON.stringify(settings));

            // 設置超時
            settingsTimeout = setTimeout(() => {
                settingsLock = false;
                saveBtn.classList.remove('loading');
                saveBtn.disabled = false;
                reloadBtn.disabled = false;
                showSettingsStatus('儲存超時，ESP32 未回應，請檢查裝置連線', 'error');
                showToast('儲存超時，請檢查裝置連線', 'error');
            }, SETTINGS_TIMEOUT_MS);
        }

        // 重新載入設定
        function reloadSettings() {
            // 檢查互斥鎖
            if (settingsLock) {
                showToast('請等待目前操作完成', 'warning');
                return;
            }

            if (!mqtt_client || !mqtt_client.connected) {
                showToast('MQTT 未連線', 'error');
                return;
            }

            // 設置互斥鎖
            settingsLock = true;
            const saveBtn = document.getElementById('saveSettingsBtn');
            const reloadBtn = document.getElementById('reloadSettingsBtn');
            reloadBtn.classList.add('loading');
            reloadBtn.disabled = true;
            saveBtn.disabled = true;
            showSettingsStatus('正在載入設定...', 'loading');

            const topics = getTopics(currentDeviceId);
            mqtt_client.publish(topics.SETTINGS_REQUEST, JSON.stringify({ action: 'load' }));

            // 設置超時
            settingsTimeout = setTimeout(() => {
                settingsLock = false;
                reloadBtn.classList.remove('loading');
                reloadBtn.disabled = false;
                saveBtn.disabled = false;
                showSettingsStatus('載入超時，ESP32 未回應，請檢查裝置連線', 'error');
                showToast('載入超時，請檢查裝置連線', 'error');
            }, SETTINGS_TIMEOUT_MS);
        }

        // 處理設定回應
        function handleSettingsResponse(message) {
            // 清除超時計時器
            if (settingsTimeout) {
                clearTimeout(settingsTimeout);
                settingsTimeout = null;
            }

            // 解除互斥鎖
            settingsLock = false;
            const saveBtn = document.getElementById('saveSettingsBtn');
            const reloadBtn = document.getElementById('reloadSettingsBtn');
            saveBtn.classList.remove('loading');
            reloadBtn.classList.remove('loading');
            saveBtn.disabled = false;
            reloadBtn.disabled = false;

            try {
                const response = JSON.parse(message);

                if (response.action === 'save_ack') {
                    // 儲存成功回應
                    if (response.success) {
                        showSettingsStatus('設定已成功儲存至 ESP32', 'success');
                        showToast('設定已儲存', 'success');
                    } else {
                        showSettingsStatus('儲存失敗：' + (response.message || '未知錯誤'), 'error');
                        showToast('儲存失敗', 'error');
                    }
                } else if (response.action === 'load_ack') {
                    // 載入設定回應
                    if (response.success && response.settings) {
                        applySettings(response.settings);
                        showSettingsStatus('設定已從 ESP32 載入', 'success');
                        showToast('設定已載入', 'success');
                    } else {
                        showSettingsStatus('載入失敗：' + (response.message || '未知錯誤'), 'error');
                        showToast('載入失敗', 'error');
                    }
                }
            } catch (e) {
                console.error('Settings response parse error:', e);
                showSettingsStatus('回應解析錯誤', 'error');
            }
        }

        // 套用設定到表單
        function applySettings(settings) {
            if (settings.watering) {
                document.getElementById('wateringEnabled').checked = settings.watering.enabled || false;
                document.getElementById('wateringDays').value = settings.watering.interval_days || 1;
                document.getElementById('wateringTime').value = settings.watering.time || '08:00';
                document.getElementById('wateringDuration').value = settings.watering.duration || 30;
                toggleSetting('watering');
            }

            if (settings.humidifier) {
                document.getElementById('humidifierEnabled').checked = settings.humidifier.enabled || false;
                document.getElementById('humidifierDays').value = settings.humidifier.interval_days || 1;
                document.getElementById('humidifierTime').value = settings.humidifier.time || '10:00';
                document.getElementById('humidifierDuration').value = settings.humidifier.duration || 60;
                toggleSetting('humidifier');
            }

            if (settings.light) {
                document.getElementById('lightEnabled').checked = settings.light.enabled || false;
                document.getElementById('lightOnTime').value = settings.light.on_time || '06:00';
                document.getElementById('lightOffTime').value = settings.light.off_time || '18:00';
                toggleSetting('light');
            }

            if (settings.fan) {
                document.getElementById('fanEnabled').checked = settings.fan.enabled || false;
                if (settings.fan.schedules && Array.isArray(settings.fan.schedules)) {
                    settings.fan.schedules.forEach((schedule, index) => {
                        const i = index + 1;
                        if (i <= 5) {
                            document.getElementById(`fanSchedule${i}Enabled`).checked = schedule.enabled || false;
                            document.getElementById(`fanTime${i}`).value = schedule.start || '08:00';
                            document.getElementById(`fanTime${i}End`).value = schedule.end || '10:00';
                        }
                    });
                }
                toggleSetting('fan');
            }

            if (settings.schedule) {
                document.getElementById('scheduleSettingEnabled').checked = settings.schedule.enabled || false;
                document.getElementById('scheduleWateringDuration').value = settings.schedule.watering_duration || 30;
                document.getElementById('scheduleVentilationDuration').value = settings.schedule.ventilation_duration || 10;
                toggleSetting('scheduleSetting');
            }
        }

        // 顯示設定狀態
        function showSettingsStatus(message, type) {
            const status = document.getElementById('settingsStatus');
            status.textContent = message;
            status.className = 'settings-status show ' + type;
        }

        // 隱藏設定狀態
        function hideSettingsStatus() {
            const status = document.getElementById('settingsStatus');
            status.className = 'settings-status';
        }

        // 驗證持續時間範圍
        function validateDuration(inputId, min, max, label) {
            const input = document.getElementById(inputId);
            const value = parseInt(input.value);

            if (isNaN(value)) {
                return;
            }

            if (value < min) {
                showToast(`${label}持續時間不能小於 ${min} 秒`, 'error');
                input.value = min;
            } else if (value > max) {
                showToast(`${label}持續時間不能超過 ${max} 秒`, 'error');
                input.value = max;
            }
        }

        // 驗證時間範圍（開始時間不能大於等於結束時間）
        function validateTimeRange(startId, endId, label) {
            const startInput = document.getElementById(startId);
            const endInput = document.getElementById(endId);
            const startTime = startInput.value;
            const endTime = endInput.value;

            // 如果其中一個時間為空，允許輸入
            if (!startTime || !endTime) {
                return true;
            }

            if (startTime >= endTime) {
                showToast(`${label}：開始時間不能晚於或等於結束時間`, 'error');
                // 清空無效的輸入
                startInput.value = '';
                return false;
            }
            return true;
        }

        // 切換側邊選單面板
        function switchPanel(panelId) {
            // 更新選單項目狀態
            document.querySelectorAll('.menu-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-panel="${panelId}"]`).classList.add('active');

            // 更新面板顯示
            document.querySelectorAll('.content-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            document.getElementById(panelId).classList.add('active');

            // 手機版關閉側邊選單
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        }

        // 切換側邊選單（手機版）
        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
        }

        // 頁面切換
        function showLoginPage() {
            document.getElementById('loginPage').classList.add('active');
            document.getElementById('controlPage').classList.remove('active');
        }

        function showControlPage() {
            document.getElementById('loginPage').classList.remove('active');
            document.getElementById('controlPage').classList.add('active');
        }

        // 登入狀態顯示
        function showLoginStatus(msg, type) {
            const status = document.getElementById('loginStatus');
            status.textContent = msg;
            status.className = 'login-status ' + type;
        }

        function hideLoginStatus() {
            document.getElementById('loginStatus').className = 'login-status';
        }

        // Toast 通知
        function showToast(msg, type = '') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';

            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // Enter 鍵登入
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !isLoggedIn) {
                handleLogin();
            }
        });

        // 點擊確認對話框外部關閉
        document.getElementById('confirmOverlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('confirmOverlay')) {
                closeConfirm();
            }
        });

        // 關閉網頁前確認
        window.addEventListener('beforeunload', (e) => {
            if (isLoggedIn) {
                e.preventDefault();
                e.returnValue = '您目前已登入控制系統，確定要離開嗎？';
                return e.returnValue;
            }
        });

        // 初始化（不自動連線，等待使用者輸入通關密語）
        window.onload = () => {
            updateMQTTStatus('disconnected');
        };
