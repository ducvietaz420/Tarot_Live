import React, { useMemo, useState } from "react";
import type { Action, Credit, Snapshot } from "../shared/types";

type Props = {
  state: Snapshot;
  action: (action: Action) => Promise<boolean>;
};
type Filter = "unspent" | "review" | "used" | "all";
const pendingStatuses = ["waiting_question", "waiting_condition", "ready"];
const formatNumber = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(value);
const formatTime = (value: number) =>
  new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export default function CreditLedger({ state, action }: Props) {
  const [filter, setFilter] = useState<Filter>("unspent");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(24);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [coins, setCoins] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { credits, queue } = state.session;
  const available = credits.filter(
    (credit) => !credit.usedBy && !credit.review && credit.coins !== null,
  );
  const availableCoins = available.reduce(
    (sum, credit) => sum + (credit.coins ?? 0),
    0,
  );
  const reviewCount = credits.filter((credit) => !!credit.review).length;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return credits
      .filter((credit) => {
        if (filter === "unspent" && credit.usedBy) return false;
        if (filter === "review" && !credit.review) return false;
        if (filter === "used" && !credit.usedBy) return false;
        if (!query) return true;
        const user = queue.find((item) => item.user.id === credit.userId)?.user;
        return [
          credit.id,
          credit.userId,
          credit.giftId,
          credit.giftName,
          user?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("vi")
          .includes(query);
      })
      .slice()
      .sort((a, b) => b.at - a.at);
  }, [credits, queue, filter, search]);

  async function perform(value: Action, success: string, key: string) {
    if (busy) return;
    setBusy(key);
    setMessage("");
    setError("");
    try {
      if (await action(value)) {
        setMessage(success);
        if (value.type === "credit-confirm") {
          setConfirmId(null);
          setCoins("");
        }
      } else {
        setError("Thao tác chưa thành công. Xem thông báo của ứng dụng.");
      }
    } catch {
      setError("Không thể lưu thao tác. Kiểm tra kết nối máy chủ rồi thử lại.");
    } finally {
      setBusy(null);
    }
  }

  function confirmCredit(credit: Credit) {
    if (!/^\d+$/u.test(coins.trim())) {
      setError("Nhập tổng xu đã xác minh bằng một số nguyên không âm.");
      return;
    }
    const value = Number(coins);
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
      setError("Tổng xu cần từ 0 đến 1.000.000.000.");
      return;
    }
    void perform(
      { type: "credit-confirm", id: credit.id, coins: value },
      "Đã xác nhận giá trị. Credit vẫn ở số dư cho tới khi được ghép vào lượt.",
      credit.id,
    );
  }

  return (
    <section
      className="panel form-panel"
      aria-label="Sổ credit và đối soát quà"
    >
      <div className="form-heading">
        <h2>Sổ credit & đối soát quà</h2>
        <p>
          Số dư đã xác nhận: <b>{formatNumber(availableCoins)} xu</b> ·{" "}
          {available.length} credit chưa dùng · {reviewCount} cần kiểm tra. Giá
          trị chưa biết không được cộng vào số dư này.
        </p>
      </div>
      <div className="section-toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="tab-buttons" aria-label="Lọc credit">
          {(
            [
              ["unspent", "Chưa sử dụng"],
              ["review", "Cần kiểm tra"],
              ["used", "Đã gắn lượt"],
              ["all", "Tất cả"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "selected" : ""}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setLimit(24);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field" style={{ margin: 0, minWidth: 180, flex: 1 }}>
          <span>Tìm tài khoản / mã credit / loại quà</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(24);
            }}
            placeholder="Tên hoặc ID chính xác"
            maxLength={256}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="info-note">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="info-note">
          {message}
        </p>
      )}
      <div className="credit-grid">
        {filtered.slice(0, limit).map((credit) => {
          const linked = credit.usedBy
            ? queue.find((item) => item.id === credit.usedBy)
            : undefined;
          const pending = queue.find(
            (item) =>
              item.user.id === credit.userId &&
              pendingStatuses.includes(item.status),
          );
          const account = queue.find(
            (item) => item.user.id === credit.userId,
          )?.user;
          const canRefund =
            !!linked && ["completed", "skipped"].includes(linked.status);
          const readyCredit =
            !credit.usedBy && !credit.review && credit.coins !== null;
          return (
            <article className="credit-item" key={credit.id}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              >
                <rect x="3" y="8" width="18" height="5" rx="1" />
                <path d="M5 13v8h14v-8M12 8v13M12 8C4 8 4 1 8 3l4 5c8 0 8-7 4-5Z" />
              </svg>
              <div>
                <b>
                  {credit.giftName} ·{" "}
                  {credit.count > 0
                    ? `${formatNumber(credit.count)} quà`
                    : "Số lượng cần xác minh"}
                </b>
                <small>
                  {account?.name ? `${account.name} · ` : ""}ID tài khoản:{" "}
                  {credit.userId}
                </small>
                <small>
                  Nguồn: {state.mode === "demo" ? "DEMO" : "TikFinity LIVE"} ·{" "}
                  {formatTime(credit.at)}
                </small>
                <small>
                  Mã credit: {credit.id} · Loại quà: {credit.giftId}
                  {credit.roomId ? ` · Room: ${credit.roomId}` : ""}
                </small>
                <small>
                  {credit.review ||
                    (credit.usedBy
                      ? `Đã gắn lượt ${linked?.user.name || credit.userId} · ${linked?.status === "completed" ? "Hoàn tất" : linked?.status === "skipped" ? "Đã bỏ qua" : linked?.status === "reading" ? "Đang đọc" : "Đang chờ"}`
                      : credit.refunded
                        ? "Đã hoàn về số dư; chưa áp dụng lại cho lượt khác."
                        : "Giá trị đã xác nhận; chưa sử dụng.")}
                </small>
                {credit.usedBy && <small>Mã lượt: {credit.usedBy}</small>}
                <div className="button-row" style={{ flexWrap: "wrap" }}>
                  {!credit.usedBy &&
                    (credit.review || credit.coins === null) && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          setConfirmId(
                            confirmId === credit.id ? null : credit.id,
                          );
                          setCoins("");
                          setError("");
                        }}
                      >
                        {confirmId === credit.id
                          ? "Đóng xác nhận"
                          : "Xác nhận xu"}
                      </button>
                    )}
                  {readyCredit && pending && (
                    <button
                      type="button"
                      disabled={!!busy}
                      title="Ghép toàn bộ credit chưa dùng, đã xác nhận của đúng ID tài khoản vào lượt đang chờ"
                      onClick={() =>
                        void perform(
                          { type: "credit-assign", id: pending.id },
                          "Đã ghép số dư đã xác nhận vào lượt chờ của đúng tài khoản.",
                          credit.id,
                        )
                      }
                    >
                      Ghép số dư vào lượt chờ
                    </button>
                  )}
                  {credit.usedBy && (
                    <button
                      type="button"
                      disabled={!!busy || !canRefund}
                      title={
                        canRefund
                          ? "Hoàn credit này về số dư, giữ lịch sử của lượt cũ"
                          : "Chỉ hoàn sau khi lượt đã hoàn tất hoặc bị bỏ qua"
                      }
                      onClick={() =>
                        void perform(
                          { type: "credit-refund", id: credit.id },
                          "Đã hoàn credit về số dư. Cần yêu cầu mới hoặc ghép thủ công để dùng lại.",
                          credit.id,
                        )
                      }
                    >
                      Hoàn về số dư
                    </button>
                  )}
                </div>
                {readyCredit && !pending && (
                  <small>
                    Chưa có lượt chờ của ID này. Credit được giữ; không tự tạo
                    lượt tiếp theo.
                  </small>
                )}
                {!credit.usedBy && credit.review && (
                  <small>
                    Cần xác nhận tổng xu trước khi ghép. Không suy đoán giá từ
                    tên quà hoặc quy đổi thành tiền mặt.
                  </small>
                )}
                {!credit.usedBy && confirmId === credit.id && (
                  <div className="inline-editor" style={{ marginTop: 12 }}>
                    <label className="field">
                      <span>Tổng xu đã xác minh cho toàn bộ credit này</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1_000_000_000}
                        step={1}
                        value={coins}
                        onChange={(event) => setCoins(event.target.value)}
                        placeholder="Nhập giá trị đã đối soát"
                        autoComplete="off"
                      />
                    </label>
                    <small>
                      Nhập tổng xu từ dữ liệu TikFinity hoặc bảng quy đổi bạn đã
                      kiểm tra. Xác nhận sẽ bỏ cờ kiểm tra; chưa tự ghép vào
                      lượt.
                    </small>
                    <button
                      type="button"
                      className="primary"
                      disabled={!!busy || !coins.trim()}
                      onClick={() => confirmCredit(credit)}
                    >
                      {busy === credit.id ? "Đang lưu…" : "Xác nhận tổng xu"}
                    </button>
                  </div>
                )}
              </div>
              <strong>
                {credit.coins === null
                  ? "Chưa biết xu"
                  : `${formatNumber(credit.coins)} xu`}
              </strong>
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="muted" style={{ marginTop: 16 }}>
          Không có credit phù hợp với bộ lọc này.
        </p>
      )}
      {filtered.length > limit && (
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" onClick={() => setLimit((value) => value + 24)}>
            Xem thêm ({formatNumber(filtered.length - limit)} credit)
          </button>
        </div>
      )}
      <p
        className="muted"
        style={{ marginTop: 18, fontSize: 12, lineHeight: 1.6 }}
      >
        Credit giữ nguyên khi hết cửa sổ ghép. Nút ghép sử dụng toàn bộ số dư đã
        xác nhận của cùng ID tài khoản; không ghép theo nickname. Các phiên đã
        lưu trữ khi mở phiên mới được giữ trong SQLite và API lịch sử.
      </p>
    </section>
  );
}
