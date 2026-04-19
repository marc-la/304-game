import GameTable from './components/GameTable/GameTable';
import ActionPanel from './components/ActionPanel/ActionPanel';
import Sidebar from './components/Sidebar/Sidebar';
import ControlBar from './components/Controls/ControlBar';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <ControlBar />
      <div className={styles.main}>
        <div className={styles.tableSection}>
          <GameTable />
        </div>
        <div className={styles.sideSection}>
          <ActionPanel />
          <Sidebar />
        </div>
      </div>
    </div>
  );
}
