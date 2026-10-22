import ast
import sqlite3
import types
import unittest
from pathlib import Path

source = ast.parse(Path(__file__).with_name('ecowitt-history-sync.py').read_text())
function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'merge_point')
namespace = {'m': types.SimpleNamespace(PRIORITY={'1day':1,'4hour':2,'30min':3,'5min':4})}
exec(compile(ast.Module(body=[function],type_ignores=[]),'merge-point-test','exec'),namespace)
merge = namespace['merge_point']

class MergeTest(unittest.TestCase):
    def test_unique_valid_value_survives_missing_higher_resolution(self):
        c = sqlite3.connect(':memory:')
        c.executescript('''CREATE TABLE ecowitt_history_cycle_points(device_key TEXT,cycle_type TEXT,metric_path TEXT,observed_at INTEGER,PRIMARY KEY(device_key,cycle_type,metric_path,observed_at));
        CREATE TABLE ecowitt_history_points(device_key TEXT,metric_path TEXT,observed_at INTEGER,value TEXT,unit TEXT,cycle_type TEXT,priority INTEGER,PRIMARY KEY(device_key,metric_path,observed_at));''')
        merge(c,'station','1day','temperature',100,'20','C')
        merge(c,'station','5min','temperature',100,'-','C')
        self.assertEqual(c.execute('select value from ecowitt_history_points').fetchone()[0],'20')
        merge(c,'station','5min','temperature',100,'21','C')
        self.assertEqual(c.execute('select value,cycle_type from ecowitt_history_points').fetchone(),('21','5min'))
        merge(c,'station','5min','temperature',100,'21','C')
        self.assertEqual(c.execute('select count(*) from ecowitt_history_points').fetchone()[0],1)
        merge(c,'station','5min','humidity',100,'-','%')
        merge(c,'station','30min','humidity',100,'60','%')
        self.assertEqual(c.execute("select value from ecowitt_history_points where metric_path='humidity'").fetchone()[0],'60')
        c.close()

if __name__ == '__main__':
    unittest.main()
