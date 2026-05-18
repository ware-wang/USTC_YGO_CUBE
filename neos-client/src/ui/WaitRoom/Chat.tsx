import { Button, Input } from "antd";
import { useTranslation } from "react-i18next";

import { IconFont, ScrollableArea, useChat } from "@/ui/Shared";

import styles from "./Chat.module.scss";

interface ChatItem {
  name: string;
  time: string;
  content: string;
}

export const Chat: React.FC = () => {
  const { dialogs, input, setInput, ref, onSend } = useChat();
  const { t: i18n } = useTranslation("Chat");
  return (
    <div className={styles.chat} data-testid="waitroom-chat">
      <ScrollableArea
        className={styles.dialogs}
        data-testid="waitroom-chat-dialogs"
        ref={ref}
      >
        {dialogs.map((item, idx) => (
          <DialogItem key={idx} {...item} />
        ))}
      </ScrollableArea>
      <div className={styles.input}>
        <Input.TextArea
          variant="borderless"
          data-testid="waitroom-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoSize
          placeholder={i18n("PleaseEnterChatContent")}
          onPressEnter={(e) => {
            e.preventDefault();
            onSend();
          }}
        />
        <Button
          type="text"
          data-testid="waitroom-chat-send"
          icon={<IconFont type="icon-send" size={16} />}
          onClick={onSend}
        />
      </div>
    </div>
  );
};

const DialogItem: React.FC<ChatItem> = ({ name, time, content }) => {
  return (
    <div className={styles.item} data-testid="waitroom-chat-message">
      <div className={styles.name}>
        {name}
        <span className={styles.time}>{time}</span>
      </div>
      <div className={styles.content}>{content}</div>
    </div>
  );
};
