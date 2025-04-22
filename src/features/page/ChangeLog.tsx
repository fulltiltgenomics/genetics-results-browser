import { useEffect, useState } from "react";
import config from "../../config.json";
import { ChangeLogItem } from "../../types/types";

const renderContent = (content: Array<ChangeLogItem>) => {
  return (
    <>
      {content.map((item, index) => {
        switch (item.type) {
          case "span":
            return (
              <span key={index}>
                {item.text}
                {item.children && renderContent(item.children)}
              </span>
            );
          case "ul":
            return <ul key={index}>{item.children && renderContent(item.children)}</ul>;
          case "li":
            return <li key={index}>{item.text}</li>;
          default:
            return null;
        }
      })}
    </>
  );
};

const ChangeLog = () => {
  const [changeLogData, setChangeLogData] = useState<{ content: Array<ChangeLogItem> } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadChangeLog = async () => {
      try {
        const changeLog =
          config.target === "public"
            ? await import("../../../changelog.json")
            : await import("../../../changelog_finngen.json");
        setChangeLogData(changeLog.default);
      } catch (err) {
        setError("Failed to load changelog");
        console.error("Error loading changelog:", err);
      }
    };

    loadChangeLog();
  }, []);

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!changeLogData) {
    return <div>Loading changelog...</div>;
  }

  return renderContent(changeLogData.content);
};

export default ChangeLog;
