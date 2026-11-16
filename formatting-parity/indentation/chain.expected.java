class Sample {
    void run() {
        users.query()
          .where(
            "active",
            "=",
            false)
          .limit(10);
    }
}
