import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("Проверяем соединение…");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/+$/, "");

        if (!apiUrl) {
          throw new Error("Не задана переменная VITE_API_URL");
        }

        const response = await fetch(`${apiUrl}/api/health`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: unknown = await response.json();

        if (
          typeof data !== "object" ||
          data === null ||
          !("status" in data) ||
          data.status !== "ok"
        ) {
          throw new Error("Неожиданный ответ сервера");
        }

        setMessage("Соединение работает: backend вернул status: ok");
      } catch (error) {
        if (controller.signal.aborted) return;

        const reason =
          error instanceof Error ? error.message : "Неизвестная ошибка";

        setMessage(`Ошибка соединения: ${reason}`);
      }
    }

    void checkHealth();

    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Inventory Admin</h1>
      <p role="status">{message}</p>
    </main>
  );
}

export default App;
